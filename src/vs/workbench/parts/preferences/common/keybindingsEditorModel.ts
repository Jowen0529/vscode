/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { distinct } from 'vs/base/common/arrays';
import { IMatch, IFilter, or, matchesContiguousSubString, matchesPrefix, matchesCamelCase, matchesWords } from 'vs/base/common/filters';
import { Registry } from 'vs/platform/platform';
import { ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { CommonEditorRegistry, EditorAction } from 'vs/editor/common/editorCommonExtensions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actionRegistry';
import { EditorModel } from 'vs/workbench/common/editor';
import { IExtensionService } from 'vs/platform/extensions/common/extensions';
import { IKeybindingService, KeybindingSource } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { KeybindingResolver } from 'vs/platform/keybinding/common/keybindingResolver';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';

export const KEYBINDING_ENTRY_TEMPLATE_ID = 'keybinding.entry.template';
export const KEYBINDING_HEADER_TEMPLATE_ID = 'keybinding.header.template';

export interface IListEntry {
	id: string;
	templateId: string;
}

export interface IKeybindingItemEntry extends IListEntry {
	keybindingItem: IKeybindingItem;
	commandIdMatches?: IMatch[];
	commandLabelMatches?: IMatch[];
	keybindingMatches?: IMatch[];
}

export interface IKeybindingItem {
	keybinding: ResolvedKeybinding;
	keybindingItem: ResolvedKeybindingItem;
	commandLabel: string;
	command: string;
	source: KeybindingSource;
	when: ContextKeyExpr;
}

const wordFilter = or(matchesPrefix, matchesWords, matchesContiguousSubString);

export class KeybindingsEditorModel extends EditorModel {

	private _keybindingItems: IKeybindingItem[];

	constructor(
		@IKeybindingService private keybindingsService: IKeybindingService,
		@IExtensionService private extensionService: IExtensionService
	) {
		super();
	}

	public fetch(searchValue: string): IKeybindingItemEntry[] {
		searchValue = searchValue.trim();
		return searchValue ? this.fetchKeybindingItems(searchValue) :
			this._keybindingItems.map(keybindingItem => ({ id: KeybindingsEditorModel.getId(keybindingItem), keybindingItem, templateId: KEYBINDING_ENTRY_TEMPLATE_ID }));
	}

	private fetchKeybindingItems(searchValue: string): IKeybindingItemEntry[] {
		const result: IKeybindingItemEntry[] = [];
		for (const keybindingItem of this._keybindingItems) {
			let keybindingMatches = new KeybindingMatches(keybindingItem, searchValue);
			if (keybindingMatches.commandIdMatches || keybindingMatches.commandLabelMatches || keybindingMatches.keybindingMatches) {
				result.push({
					id: KeybindingsEditorModel.getId(keybindingItem),
					templateId: KEYBINDING_ENTRY_TEMPLATE_ID,
					commandLabelMatches: keybindingMatches.commandLabelMatches,
					keybindingItem,
					keybindingMatches: keybindingMatches.keybindingMatches,
					commandIdMatches: keybindingMatches.commandIdMatches
				});
			}
		}
		return result;
	}

	public resolve(): TPromise<EditorModel> {
		return this.extensionService.onReady()
			.then(() => {
				const workbenchActionsRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
				const editorActions = CommonEditorRegistry.getEditorActions().reduce((editorActions, editorAction) => {
					editorActions[editorAction.id] = editorAction;
					return editorActions;
				}, {});
				this._keybindingItems = this.keybindingsService.getKeybindings().map(keybinding => KeybindingsEditorModel.toKeybindingEntry(keybinding, workbenchActionsRegistry, editorActions));
				const boundCommands: Map<string, boolean> = this._keybindingItems.reduce((boundCommands, keybinding) => {
					boundCommands.set(keybinding.command, true);
					return boundCommands;
				}, new Map<string, boolean>());
				for (const command of KeybindingResolver.getAllUnboundCommands(boundCommands)) {
					this._keybindingItems.push(KeybindingsEditorModel.toUnassingedKeybindingEntry(command, workbenchActionsRegistry, editorActions));
				}
				this._keybindingItems = this._keybindingItems.sort((a, b) => KeybindingsEditorModel.compareKeybindingData(a, b));
				return this;
			});
	}

	private static getId(keybindingItem: IKeybindingItem): string {
		return keybindingItem.command + (keybindingItem.keybinding ? keybindingItem.keybinding.getAriaLabel() : '') + keybindingItem.source + (keybindingItem.when ? keybindingItem.when.serialize() : '');
	}

	private static compareKeybindingData(a: IKeybindingItem, b: IKeybindingItem): number {
		if (a.keybinding && !b.keybinding) {
			return -1;
		}
		if (b.keybinding && !a.keybinding) {
			return 1;
		}
		if (a.commandLabel && !b.commandLabel) {
			return -1;
		}
		if (b.commandLabel && !a.commandLabel) {
			return 1;
		}
		if (a.commandLabel && b.commandLabel) {
			if (a.commandLabel !== b.commandLabel) {
				return a.commandLabel.localeCompare(b.commandLabel);
			}
		}
		if (a.command === b.command) {
			return a.source === KeybindingSource.User ? -1 : 1;
		}
		return a.command.localeCompare(b.command);
	}

	private static toKeybindingEntry(keybinding: ResolvedKeybindingItem, workbenchActionsRegistry: IWorkbenchActionRegistry, editorActions: {}): IKeybindingItem {
		const workbenchAction = workbenchActionsRegistry.getWorkbenchAction(keybinding.command);
		const editorAction: EditorAction = editorActions[keybinding.command];
		return <IKeybindingItem>{
			keybinding: keybinding.resolvedKeybinding,
			keybindingItem: keybinding,
			command: keybinding.command,
			commandLabel: editorAction ? editorAction.label : workbenchAction ? workbenchAction.label : '',
			when: keybinding.when,
			source: keybinding.isDefault ? KeybindingSource.Default : KeybindingSource.User
		};
	}

	private static toUnassingedKeybindingEntry(command: string, workbenchActionsRegistry: IWorkbenchActionRegistry, editorActions: {}): IKeybindingItem {
		const workbenchAction = workbenchActionsRegistry.getWorkbenchAction(command);
		const editorAction: EditorAction = editorActions[command];
		return <IKeybindingItem>{
			keybinding: null,
			keybindingItem: new ResolvedKeybindingItem(null, command, null, null, true),
			command: command,
			commandLabel: editorAction ? editorAction.label : workbenchAction ? workbenchAction.label : '',
			when: null,
			source: KeybindingSource.Default
		};
	}
}

class KeybindingMatches {
	public readonly commandIdMatches: IMatch[] = null;
	public readonly commandLabelMatches: IMatch[] = null;
	public readonly keybindingMatches: IMatch[] = null;

	constructor(keybindingItem: IKeybindingItem, searchValue: string) {
		this.commandIdMatches = this.matches(searchValue, keybindingItem.command, or(matchesWords, matchesCamelCase));
		this.commandLabelMatches = keybindingItem.commandLabel ? this.matches(searchValue, keybindingItem.commandLabel, (word, wordToMatchAgainst) => matchesWords(word, keybindingItem.commandLabel, true)) : null;
		this.keybindingMatches = keybindingItem.keybinding ? this.keyMatches(searchValue, keybindingItem.keybinding.getAriaLabel(), or(matchesWords, matchesCamelCase)) : null;
	}

	private matches(searchValue: string, wordToMatchAgainst: string, wordMatchesFilter: IFilter): IMatch[] {
		let matches = wordFilter(searchValue, wordToMatchAgainst);
		if (!matches) {
			matches = this.matchesWords(searchValue.split(' '), wordToMatchAgainst, wordMatchesFilter);
		}
		if (matches) {
			matches = this.filterAndSort(matches);
		}
		return matches;
	}

	private keyMatches(searchValue: string, wordToMatchAgainst: string, wordMatchesFilter: IFilter): IMatch[] {
		let matches = this.matches(searchValue, wordToMatchAgainst, wordMatchesFilter);
		if (!matches) {
			matches = this.matchesWords(searchValue.split('+'), wordToMatchAgainst, wordMatchesFilter);
			if (matches) {
				matches = this.filterAndSort(matches);
			}
		}
		return matches;
	}

	private matchesWords(words: string[], wordToMatchAgainst: string, wordMatchesFilter: IFilter): IMatch[] {
		let matches = [];
		for (const word of words) {
			const wordMatches = wordMatchesFilter(word, wordToMatchAgainst);
			if (wordMatches) {
				matches = [...(matches || []), ...wordMatches];
			} else {
				matches = null;
				break;
			}
		}
		return matches;
	}

	private filterAndSort(matches: IMatch[]): IMatch[] {
		return distinct(matches, (a => a.start + '.' + a.end)).filter(match => !matches.some(m => !(m.start === match.start && m.end === match.end) && (m.start <= match.start && m.end >= match.end))).sort((a, b) => a.start - b.start);;
	}
}