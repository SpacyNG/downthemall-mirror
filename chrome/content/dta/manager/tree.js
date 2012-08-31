/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is DownThemAll!
 *
 * The Initial Developer of the Original Code is Nils Maier
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Nils Maier <MaierMan@web.de>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const FilePicker = Construct('@mozilla.org/filepicker;1', 'nsIFilePicker', 'init');

let ImportExport = {};
module('resource://dta/manager/imex.jsm', ImportExport);

const Tree = {
	init: function T_init(elem) {
		this.elem = elem;
		this._downloads = [];
		this._speedLimitList = $('perDownloadSpeedLimitList');
		
		addEventListener('blur', function() Tree.stopTip(), false);
		
		let tp = this;
		this.elem.addEventListener('dblclick', function() FileHandling.openFile(), false);
		this.elem.addEventListener('select', function() tp.selectionChanged(), false);
		this.elem.addEventListener('click', function(evt) { if (evt.button == 1) tp.showInfo(); }, false);
		
		let dtree = $('downloadList');
		dtree.addEventListener('mousemove', function(event) tp.hovering(event), false);
		dtree.addEventListener('dragstart', function(event) tp.onDragStart(event), false);
		
		$('popup').addEventListener('popupshowing', function(event) tp.onPopupShowing(event), true);

		
		ServiceGetter(this, "_ww", "@mozilla.org/embedcomp/window-watcher;1", "nsIWindowWatcher");
		ServiceGetter(this, "_as", "@mozilla.org/atom-service;1", "nsIAtomService");
		
		for each (let e in ['iconic', 'completed', 'inprogress', 'paused', 'canceled', 'pausedUndetermined', 'pausedAutoretrying', 'verified', 'progress']) {
			this['_' + e] = this._as.getAtom(e);
		}
		this.elem.view = this;	
		this.assembleMenus();
		this.refreshTools();
	},
	onPopupShowing: function(event) {
		let cascadeMirrors = this.current.urlManager.length < 2;
		$('mirrors', 'mirrors-sep').forEach(function(e) e.hidden = cascadeMirrors);
		$('mirrors-cascaded', 'mirrors-cascaded-sep').forEach(function(e) e.hidden = !cascadeMirrors);
		
		this.showSpeedLimitList(event);
	},
	assembleMenus: function() {
		for each (let popup in $('removeCompletedPopup', 'removePopup')) {
			while (popup.lastChild) {
				if (popup.lastChild.localName == 'menuseparator') {
					break;
				}
				popup.removeChild(popup.lastChild);
			}
			let id = popup.id;
			for (let f in new Utils.SimpleIterator(DTA.FilterManager.enumAll(), Ci.dtaIFilter)) {
				if (f.id == 'deffilter-all') {
					continue;
				}
				let filter = f; // clone for closure
				let mi = document.createElementNS(popup.namespaceURI, 'menuitem');
				mi.setAttribute('label', filter.label);
				mi.setAttribute('class', 'menuitem-iconic menuitem-filter');
				popup.appendChild(mi);
				mi.addEventListener('command', function() Tree.removeByFilter(filter, id), true);
			}
		}
	},
	clear: function() {
		Debug.logString("Tree: clearing");
		this.beginUpdate();
		this._downloads = [];
		this.elem.view = this;
		this.endUpdate();
	},

	/*
	 * actual nsITreeView follows
	 */
	get rowCount() {
		return this._downloads.length;
	},
	setTree: function T_setTree(box) {
		if (!box) {
			return;
		}
		this._box = box.QueryInterface(Ci.nsITreeBoxObject);
		this._cols = [];
		for (let i = 0; i < box.columns.count; ++i) {
			this._cols.push(box.columns.getColumnAt(i));
		}
	},
	getParentIndex: function T_getParentIndex(idx) {
		// no parents, as we are actually a list
		return -1;
	},
	getLevel: function T_getLevel(idx) {
		// ... and being a list all nodes are on the same level
		return 0;
	},
	getCellText: function T_getCellText(idx, col) {
		let d = this._downloads[idx];
		if (!d) return '';

		switch (col.index) {
			case 0: return Prefs.showOnlyFilenames ? d.destinationName : d.urlManager.usable;
			case 2: return d.percent;
			case 3: return d.dimensionString;
			case 4: return d.status;
			case 5: return d.speed;
			case 6: return d.parts;
			case 7: return d.mask;
			case 8: return d.destinationPath;
			case 9: return d.prettyHash;
		}
		return '';
	},
	isSorted: function T_isSorted() true,
	isContainer: function T_isContainer(idx) false,
	isContainerOpen: function T_isContainerOpen(idx) false,
	isContainerEmpty: function T_isContainerEmpty(idx) false,
	isSeparator: function T_isSeparator(idx) false,
	isEditable: function T_isEditable(idx) true,

	// will grab the "icon" for a cell.
	getImageSrc: function T_getImageSrc(idx, col) {},
	getProgressMode : function T_getProgressMode(idx, col) {
		if (col.index == 1) {
			let d = this._downloads[idx];
			if (!d) return 2;
			if (d.is(PAUSED) && (!d.totalSize || d.progress < 5)) {
				return 2; // PROGRESS_UNDETERMINED;
			}
			if (d.is(RUNNING) && !d.totalSize) {
				return 2; // PROGRESS_UNDETERMINED;			
			}
			return 1; // PROGRESS_NORMAL;
		}
		return 3; // PROGRESS_NONE;
	},
	// will be called for cells other than textcells
	getCellValue: function T_getCellValue(idx, col) {
		if (col.index == 1) {
			let d = this._downloads[idx];
			if (!d) return 0;
			if (d.isOf(CANCELED | COMPLETE)) {
				return 100; 
			}
			return d.progress || 0;
		}
		return null;
	},
	getCellProperties: function T_getCellProperties(idx, col, prop) {
		let cidx = col.index;
		if (cidx == 1) {
			prop.AppendElement(this._iconic);
			prop.AppendElement(this._progress);
			let d = this._downloads[idx];
			if (!d) return;
			switch (d.state) {
				case PAUSED:
					prop.AppendElement(this._paused);
					if (!d.totalSize || d.progress < 5) {
						prop.AppendElement(this._pausedUndetermined);
					}
					if (d.autoRetrying) {
						prop.AppendElement(this._pausedAutoretrying);
					}
				return;
				case FINISHING:
				case RUNNING: prop.AppendElement(this._inprogress); return;
				case CANCELED: prop.AppendElement(this._canceled); return;
				case COMPLETE:
					prop.AppendElement(this._completed);
					if (d.hashCollection) {
						prop.AppendElement(this._verified);
					}
				return;
			}
		}
		else if (cidx == 0) { 
			prop.AppendElement(this._iconic);
			prop.AppendElement(this._downloads[idx].iconAtom);
		}
	},
	// just some stubs we need to provide anyway to implement a full nsITreeView
	cycleHeader: function T_cycleHeader(col, elem) {},
	cycleCell: function(idx, column) {},
	performAction: function(action) {},
	performActionOnRow: function(action, index, column) {},
	performActionOnCell: function(action, index, column) {},
	getColumnProperties: function(column, element, prop) {},
	getRowProperties: function(idx, prop) {},
	setCellValue: function(idx, col, value) {},
	selectionChanged: function T_selectionChanged() {
		this.refreshTools();
	},

	onDragStart: function T_onDragStart(event) {
		let transfer = event.dataTransfer;
		transfer.effectAllowed = "copymove";
		for (let qi in this.selected) {
			try {
				transfer.setData("application/x-dta-position", qi.position);
			}
			catch (ex) {
				Debug.log("dnd failure", ex);
			}
			return;
		}
	},
	canDrop: function T_canDrop(index, orient, dt) {
		let rv = dt.types.contains("application/x-dta-position");
		if (rv) {
			dt.dropEffect = "move";
		}
		return rv;
	},
	drop: function T_drop(row, orientation, dt) {
		Debug.logString("drop");
		if (!this.canDrop(row, orientation, dt)) {
			return;
		}
		try {
			this.beginUpdate();
			// means insert_after, so we need to adjust the row
			if (orientation == 1) {
				++row;
			}
			/* first we remove the dragged items from the list
			 * then we reinsert them
			 * if the dragged item is location before the drop position we need to adjust it (as we remove the item first)
			 * after we collected all items we simply reinsert them and invalidate our list.
			 * This might not be the most performant way, but at least it kinda works ;)
			 */
			let downloads = this._getSelectedIds(true).map(
				function(id) {
					let qi = this._downloads[id];
					if (id < row) {
						--row;
					}
					this._downloads.splice(id, 1);
					return qi;					
				},
				this
			);
			for each (let qi in downloads) {
				this._downloads.splice(row, 0, qi);
			}
			
			this.endUpdate();
			this.invalidate();
			this._box.ensureRowIsVisible(Math.max(row, 0));
			this.selection.rangedSelect(row, row + downloads.length - 1, true);
		}
		catch (ex) {
			Debug.log("_dropSelection", ex);
		}		
	},
	
	_updating: 0,
	beginUpdate: function T_beginUpdate() {
		if (++this._updating == 1) {
			this._box.beginUpdateBatch();
		}
	},
	endUpdate: function T_endUpdate() {
		if (--this._updating == 0) {
			this._box.endUpdateBatch();
			this.refreshTools();
			if (this._mustFireChangeEvent) {
				this._mustFireChangeEvent = false;
				this.fireChangeEvent();
			}
		}
	},
	add: function T_add(download) {
		this._downloads.push(download);
		let pos = this._downloads.length - 1;
		if (!this._updating) {
			this._box.rowCountChanged(pos, 1);
		}
		this.fireChangeEvent();
		return pos;
	},
	scrollToNearest: function(download) {
		if (!download || download.position < 0) {
			// Cannot scroll to a deleted download
			return;
		}
		let pageLength = this._box.getPageLength();
		if (this.rowCount - download.position <= pageLength) {
			this._box.scrollToRow(this.rowCount - pageLength);	
		}
		else {
			this._box.scrollToRow(download.position);
		}
	},	
	removeWithConfirmation: function T_removeWithConfirmation() {
		if (Prefs.confirmRemove) {
			let res = Prompts.confirm(window, _('removetitle'), _('removequestion'), Prompts.YES, Prompts.NO, null, 0, false, _('removecheck'));
			if (res.checked) {
				Preferences.setExt('confirmremove', false);
			}
			if (res.button) {
				return;
			}
		}
		this.remove(null, true);
	},
	removeAllWithConfirmation: function T_removeAllWithConfirmation() {
		let res = Prompts.confirm(window, _('removetitle'), _('removeallquestion'), Prompts.YES, Prompts.NO);
		if (res) {
			return;
		}
		this.remove(this._downloads.map(function(e) e), true);
	},
	removeByFilter: function T_removeByFilter(filter, id) {
		if (!(filter instanceof Ci.dtaIFilter)) {
			throw new Exception("Invalid access");
		}
		
		let pref = null;
		let mask = -1;
		let msg = null;
		switch (id) {
		case 'removePopup':
			pref = 'confirmremove.' + filter.id;
			msg = 'removefilterquestion';
			mask = COMPLETE | QUEUED | CANCELED | PAUSED;
			break;
		case 'removeCompletedPopup':
			pref = 'confirmremovecompleted.' + filter.id;
			msg = 'removecompletedfilterquestion';
			mask = COMPLETE;
			break;
		default:
			throw new Exception("Invalid access");
		}
		
		if (Preferences.getExt(pref, true)) {
			let res = Prompts.confirm(
				window,
				_('removetitle'),
				_(msg, [filter.label]),
				Prompts.YES, Prompts.NO,
				null, 0, false, _('removecheck'));
			if (res.checked) {
				Preferences.setExt(pref, false);
			}
			if (res.button) {
				return;
			}
		}		
		
		let downloads = [];
		for (let d in this.all) {
			if (!(d.state & mask)) {
				continue;
			}
			if (!filter.match(d.urlManager.url) && !filter.match(d.destinationName)) {
				continue;
			}
			downloads.push(d);
		}
		if (downloads.length) {
			Tree.remove(downloads);
		}
	},
	_mustFireChangeEvent: false,
	fireChangeEvent: function() {
		if (this._updating) {
			this._mustFireChangeEvent = true;
			return;
		}
		let evt = document.createEvent("UIEvents");
		evt.initUIEvent("change", true, true, null, 0);
		return this.elem.dispatchEvent(evt);
	},
	remove: function T_remove(downloads, performJump) {
		if (downloads && !(downloads instanceof Array)) {
			downloads = [downloads];
		}
		else if (!downloads) {
			downloads = this._getSelectedIds(true).map(function(idx) this._downloads[idx], this);
		}
		if (!downloads.length) {
			return;
		}
	
		downloads = downloads.sort(function(a, b) b.position - a.position);	 
		QueueStore.beginUpdate();
		this.beginUpdate();
		let last = 0;
		for each (let d in downloads) {
			if (d.is(FINISHING)) {
				// un-removable :p
				return;
			}
			// wipe out any info/tmpFiles
			if (!d.isOf(COMPLETE | CANCELED)) {
				d.deleting = true;
				d.cancel();
			}
			this._downloads.splice(d.position, 1);
			this._box.rowCountChanged(d.position, -1);
			last = Math.max(d.position, last);
			d.remove();
			Dialog.wasRemoved(d);
		}
		QueueStore.endUpdate();
		this.endUpdate();
		this.invalidate();
		this.fireChangeEvent();
		
		if (performJump) {
			this._removeJump(downloads.length, last);
		}
	},
	_removeCompleted: function T__removeCompleted(onlyGone) {
		QueueStore.beginUpdate();
		this.beginUpdate();
		let delta = this._downloads.length, last = 0;
		for (let i = delta - 1; i > -1; --i) {
			let d = this._downloads[i];
			if (!d.is(COMPLETE)) {
				continue;
			}
			if (onlyGone && (new FileFactory(d.destinationFile).exists())) {
				continue;
			}
			this._downloads.splice(d.position, 1);
			this._box.rowCountChanged(d.position, -1);
			last = Math.max(d.position, last);
			d.remove();						
		}
		QueueStore.endUpdate();
		this.endUpdate();	
		if (delta == this._downloads.length) {
			return;
		}
		this.invalidate();		
	},
	removeCompleted: function T_removeCompleted() {
		if (Prefs.confirmRemoveCompleted) {
			let res = Prompts.confirm(window, _('removetitle'), _('removecompletedquestion'), Prompts.YES, Prompts.NO, null, 0, false, _('removecheck'));
			if (res.checked) {
				Preferences.setExt('confirmremovecompleted', false);
			}
			if (res.button) {
				return;
			}
		}
		this._removeCompleted(false);
	},
	removeDupes: function() {
		let known = {};
		let dupes = [];
		for (let d in this.all) {
			let url = d.urlManager.url.spec; 
			if (url in known) {
				if (d.isOf(COMPLETE | FINISHING)) {
					continue;
				}				
				dupes.push(d);
			}
			else {
				known[url] = null;
			}
		}
		if (dupes.length) {
			this.remove(dupes);
			return true;
		}
		return false;
	},
	removeGone: function T_removeGone() {
		this._removeCompleted(true);
	},
	_removeJump: function(delta, last) {
		if (!this.rowCount) {
			this._box.ensureRowIsVisible(0);
		}
		else {
			let np = Math.max(0, Math.min(last - delta + 1, this.rowCount - 1));
			if (np < this._box.getFirstVisibleRow() || np > this._box.getLastVisibleRow()) {
				this._box.ensureRowIsVisible(np);
			}
			this.selection.currentIndex = np;
		}
	},
	pause: function T_pause() {
		let paused = _("paused");
		this.updateSelected(
			function(d) {
				if (d.isOf(QUEUED | PAUSED) || (d.is(RUNNING) && d.resumable)) {
					d.pause();
					d.clearAutoRetry();
					d.status = paused;
					d.state = PAUSED;
				}
				return true;
			}
		);
	},
	resume: function T_resume(d) {
		this.updateSelected(
			function(d) {
				if (d.isOf(PAUSED | CANCELED)) {
					d.queue();
				}
				return true;
			}
		);
	},
	cancel: function T_cancel() {
		if (Prefs.confirmCancel) {
			let many = this.selection.count > 1;
			let res = Prompts.confirm(
					window,
					_('canceltitle'),
					_(many ? 'cancelmanytext' : 'canceltext' ), 
					_(many ? 'docancelmany' : 'docancel'), 
					_('dontcancel'), 
					null, 1, false, _('removecheck'));
			if (res.checked) {
				Preferences.setExt('confirmcancel', false);
			}
			if (res.button) {
				return;
			}
		}
		this.updateSelected(function(d) d.cancel() || true);
	},
	selectAll: function T_selectAll() {
		this.selection.selectAll();
		this.selectionChanged();
	},
	selectInv: function T_selectInv() {
		for (let d in this.all) {
			this.selection.toggleSelect(d.position);
		}
		this.selectionChanged();
	},
	changeChunks: function T_changeChunks(increase) {
		function inc(d) {
			if (d.maxChunks < 10 && d.resumable) {
				++d.maxChunks;
			}
			return true;
		};
		function dec(d) {
			if (d.maxChunks > 1) {
				--d.maxChunks;
			}
			return true;
		};
		Tree.updateSelected(increase ? inc : dec);
	},
	force: function T_force() {
		for (let d in Tree.selected) {
			if (d.isOf(QUEUED | PAUSED | CANCELED)) {
				d.queue();
				Dialog.run(d);
			}
		}
	},
	manageMirrors: function T_manageMirrors() {
		if (!this.current) {
			return;
		}
		let mirrors = this.current.urlManager.toArray();
		openDialog(
			'chrome://dta/content/dta/mirrors.xul',
			null,
			"chrome,dialog,resizable,modal,centerscreen",
			mirrors
		);
		if (mirrors.length) {
			this.current.replaceMirrors(mirrors);
			Debug.logString("New mirrors set " + mirrors);
		}		
	},
	export: function T_export() {
		try {
			let fp = new FilePicker(window, _('exporttitle'), Ci.nsIFilePicker.modeSave);
			fp.appendFilters(Ci.nsIFilePicker.filterHTML | Ci.nsIFilePicker.filterText);
			fp.appendFilter(_('filtermetalink'), '*.metalink');
			fp.defaultExtension = "metalink";
			fp.filterIndex = 2;
			
			let rv = fp.show();
			if (rv == Ci.nsIFilePicker.returnOK || rv == Ci.nsIFilePicker.returnReplace) {
								if (/\.x?html$/i.test(fp.file.leafName)) { 
										ImportExport.exportToHtmlFile(this.selected, document, fp.file, Prefs.permissions); 
										return; 
							} 
							if (/\.metalink$/i.test(fp.file.leafName)) { 
											ImportExport.exportToMetalinkFile(this.selected, document, fp.file, Prefs.permissions); 
											return; 
							} 
							ImportExport.exportToTextFile(this.selected, fp.file, Prefs.permissions); 
							return;
			}
		}
		catch (ex) {
			Debug.log("Cannot export downloads", ex);		
			Prompts.alert(window, _('exporttitle'), _('exportfailed'));
		}
	},
	import: function T_import() {
		try {
			let fp = new FilePicker(window, _('importtitle'), Ci.nsIFilePicker.modeOpen);
			fp.appendFilters(Ci.nsIFilePicker.filterText);
			fp.appendFilter(_('filtermetalink'), '*.metalink');
			fp.defaultExtension = "metalink";
			fp.filterIndex = 1;
			
			let rv = fp.show();
			if (rv == Ci.nsIFilePicker.returnOK) {
								if (/\.(xml|meta(4|link))$/.test(fp.file.leafName)) { 
										Metalinker.handleFile(fp.file); 
										return; 
							} 
							let links = ImportExport.parseTextFile(fp.file); 
							if (links.length) { 
											DTA.saveLinkArray(window, links, []); 
							} 
							return; 
						}
		}
		catch (ex) {
			Debug.log("Cannot import downloads", ex);		
			Prompts.alert(window, _('importtitle'), _('importfailed'));
		}
	},
	showInfo: function T_showInfo() {
		this.beginUpdate();
		let downloads = [];
		for (let d in Tree.selected) {
			downloads.push(d);
		}
		if (downloads.length) {
			Dialog.openInfo(downloads);		 
		}
		this.endUpdate();
	},
	_hoverItem: null,
	hovering: function(event) {
		if (!Prefs.showTooltip || this._ww.activeWindow != window) {
			return;
		}
		this._hoverItem = {x: event.clientX, y: event.clientY};
	},
	showTip: function(event) {
		if (!Prefs.showTooltip || !this._hoverItem || this._ww.activeWindow != window) {
			return false;
		}
		let row = {};
		this._box.getCellAt(this._hoverItem.x, this._hoverItem.y, row, {}, {});
		if (row.value == -1) {
			return false;
		}
		let d = this.at(row.value);
		if (!d) {
			return false;
		}
		$("infoIcon").src = d.largeIcon;
		$("infoURL").value = d.urlManager.url.spec;
		$("infoDest").value = d.destinationFile;
	
		Tooltip.start(d);			
		return true;
	},	
	stopTip: function T_stopTip() {
		Tooltip.stop();
	},
	refreshTools: function T_refreshTools(d) {
		if (this._updating || (d && ('position' in d) && !this.selection.isSelected(d.position))) {
			return;
		}
		try {
			let empty = this.current == null;
				
			let states = {
				_state: 0,
				resumable: false,
				is: function(s) this._state & s,  
				isOf: QueueItem.prototype.isOf,
				count: this.selection.count,
				rows: this.rowCount,
				min: this.rowCount,
				max: 0
			};
			for (let d in this.selected) {
				states._state |= d.state;
				states.resumable |= d.resumable;
				states.min = Math.min(d.position, states.min);
				states.max = Math.max(d.position, states.max);
			}
			let cur = this.current;
			states.curFile = (cur && cur.is(COMPLETE) && (new FileFactory(cur.destinationFile)).exists());
			states.curFolder = (cur && (new FileFactory(cur.destinationPath)).exists());
							
			function modifySome(items, f) {
				let disabled;
				if (empty) {
					disabled = true;
				}
				else {
					disabled = !f(states);
				}
				if (!(items instanceof Array)) {
					items.setAttribute('disabled', disabled);
					return;
				}
				for each (let o in items) { 
					o.setAttribute('disabled', disabled);
				}
			}
			
			modifySome($('cmdResume'), function(d) d.isOf(PAUSED | QUEUED | CANCELED));
			modifySome($('cmdPause'), function(d) (d.is(RUNNING) && d.resumable) || d.is(QUEUED));
			modifySome($('cmdCancel'), function(d) d.isOf(PAUSED | RUNNING | QUEUED | COMPLETE));

			modifySome($('cmdLaunch'), function(d) !!d.curFile);
			modifySome($('cmdOpenFolder'), function(d) !!d.curFolder);
			modifySome($('cmdDelete'), function(d) d.is(COMPLETE));

			modifySome($('cmdRemoveSelected', 'cmdExport', 'cmdGetInfo', 'perDownloadSpeedLimit'), function(d) !!d.count);
			modifySome($('cmdMirrors'), function(d) d.count == 1);

			modifySome($('cmdAddChunk', 'cmdRemoveChunk', 'cmdForceStart'), function(d) d.isOf(QUEUED | RUNNING | PAUSED | CANCELED));
			modifySome($('cmdMoveTop', 'cmdMoveUp'), function(d) d.min > 0);
			modifySome($('cmdMoveDown', 'cmdMoveBottom'), function(d) d.max != d.rows - 1);
		}
		catch (ex) {
			Debug.log("rt", ex);
		}
	},
	_invalidate_position: function(e, i) {
		if (e.position != i) {
			e.position = i;
			this.updated = true;
		}
		if (e.is(COMPLETE)) {
			this.complete++;
		}
	},
	invalidate: function T_invalidate(d, cell) {
		if (!d) {
			let c = {complete: 0, updated: false };
			QueueStore.beginUpdate();
			this._downloads.forEach(this._invalidate_position, c); 
			QueueStore.endUpdate();
			this._box.invalidate();
			this.refreshTools(this);
			Dialog.completed = c.complete;
			if (c.updated) {
				this.fireChangeEvent();
			}
		}
		else if (d instanceof Array) {
			this.beginUpdate();
			this._box.invalidateRange(d[0].position, d[d.length - 1].position);
			this.endUpdate();
		}
		else if (d.position >= 0) {
			if (cell !== undefined) {
				this._box.invalidateCell(d.position, this._cols[cell]);
			}
			else {
				this._box.invalidateRow(d.position);
			}
		}
	},
	get box() {
		return this._box;
	},
	// generator for all download elements.
	get all() {
		for (let i = 0, e = this._downloads.length; i < e; ++i) {
			yield this._downloads[i];
		}
	},
	// generator for selected download elements.
	// do not make any assumptions about the order.
	get selected() {
		// loop through the selection as usual
		for (let i = 0, e = this.selection.getRangeCount(); i < e; ++i) {
			let start = {}, end = {value: -1};
			this.selection.getRangeAt(i, start, end);
			for (let j = start.value, k = end.value; j <= k; ++j) {
					yield this._downloads[j];
			}
		}
	},
	// returns an ASC sorted array of IDs that are currently selected.
	_getSelectedIds: function T_getSelectedIds(getReversed) {
		let rv = [];
		let select = this.selection;
		// loop through the selection as usual
		for (let i = 0, e = select.getRangeCount(); i < e; ++i) {
				let start = {}, end = {};
				this.selection.getRangeAt(i, start, end);
				for (let j = start.value, k = end.value; j <= k; ++j) {
					rv.push(j);
				}
		}
		this.selection.clearSelection();
		if (getReversed) {
			rv.sort(function(a, b) { return b - a; });
		}
		else {
			rv.sort(function(a, b) { return a - b; });
		}
		return rv;
	},
	// get the first selected item, NOT the item which has the input focus.
	get current() {
		let select = this.selection;
		try {
			let ci = {value: -1};
			this.selection.getRangeAt(0, ci, {});			
			if (ci.value > -1 && ci.value < this.rowCount) {
				return this._downloads[ci.value];
			}
		}
		catch (ex) {
			// fall-through
		}
		return null;		
	},
	// get the currently focused item.
	get focused() {
		let ci = this.selection.currentIndex;
		if (ci > -1 && ci < this.rowCount) {
			return this._downloads[ci];
		}
		return null;		
	},
	at: function T_at(idx) {
		return this._downloads[idx];
	},
	some: function T_some(f, t) {
		return this._downloads.some(f, t);
	},
	every: function T_every(f, t) {
		return this._downloads.every(f, t);
	},
	update: function T_update(f, t) {
		this.beginUpdate();
		f.call(t);
		this.endUpdate();
	},
	updateSelected: function T_updateSelected(f, t) {
		this.beginUpdate();
		QueueStore.beginUpdate();
		for (d in this.selected) {
			if (!f.call(t, d)) {
				break;
			}
		}
		QueueStore.endUpdate();
		this.endUpdate();
		this.invalidate();
	},
	updateAll: function T_updateAll(f, t) {
		this.beginUpdate();
		QueueStore.beginUpdate();
		for (let d in this.all) {
			if (!f.call(t, d)) {
				break;
			}
		}
		QueueStore.endUpdate();
		this.endUpdate();
	},
	top: function T_top() {
		try {
			this.beginUpdate();
			let ids = this._getSelectedIds(true); 
			ids.forEach(
				function(id, idx) {
					id = id + idx;
					this._downloads.unshift(this._downloads.splice(id, 1)[0]);
				},
				this
			);
			this.endUpdate();
			this.invalidate();
			this.selection.rangedSelect(0, ids.length - 1, true);
			this._box.ensureRowIsVisible(0);
		}
		catch (ex) {
			Debug.log("Mover::top", ex);
		} 
	},
	bottom: function T_bottom() {
		try {
			this.beginUpdate();
			let ids = this._getSelectedIds();
			ids = ids.map(
				function(id, idx) {
					id = id - idx;
					this._downloads.push(this._downloads.splice(id, 1)[0]);
				},
				this
			);
			this.endUpdate();
			this.invalidate();
			this.selection.rangedSelect(this._downloads.length - ids.length, this._downloads.length - 1, true);
			this._box.ensureRowIsVisible(this.rowCount - 1);
		}
		catch (ex) {
			Debug.log("Mover::bottom", ex);
		} 
	},
	up: function T_up() {
		try {
			this.beginUpdate();
			let ids = this._getSelectedIds().map(
				function(id, idx) {
					if (id - idx != 0) {
						[this._downloads[id], this._downloads[id - 1]] = [this._downloads[id - 1], this._downloads[id]];
						--id;
					}
					this.selection.rangedSelect(id, id, true);
					return id;
				},
				this
			);
			this.endUpdate();
			this.invalidate();
			this._box.ensureRowIsVisible(Math.max(ids.shift() - 1, 0));
		}
		catch (ex) {
			Debug.log("Mover::up", ex);
		}	 
	},
	down: function T_down() {
		try {
			this.beginUpdate();
			let rowCount = this.rowCount;
			let ids = this._getSelectedIds(true).map(
				function(id, idx) {
					if (id + idx != rowCount - 1) {
						let tmp = this._downloads[id];
						this._downloads[id] = this._downloads[id + 1];
						this._downloads[id + 1] = tmp;
						++id;
					}
					this.selection.rangedSelect(id , id, true);
					return id;
				},
				this
			);
			this.endUpdate();
			this.invalidate();
			// readjust view
			this._box.ensureRowIsVisible(Math.min(ids.shift(), this.rowCount - 1));
		}
		catch (ex) {
			Debug.log("Mover::down", ex);
		}	 
	},
	showSpeedLimitList: function(event) {
		if (!this.selection.count) {
			return false;
		}
		let selection = this.selected;
		let limit = selection.next().speedLimit;
		for (let qi in selection) {
			if (limit != qi.speedLimit) {
				limit = -1;
			}
		}
		this._speedLimitList.limit = limit;
		return true;
	},
	changePerDownloadSpeedLimit: function() {
		let limit = $('perDownloadSpeedLimitList').limit;
		this.updateSelected(function(d) (d.speedLimit = limit) || true); 
	}
};

const FileHandling = {
	get _uniqueList() {
		let u = {};
		for (d in Tree.selected) {
			if (d.is(COMPLETE)) {
				let f = d.destinationFile;
				if (SYSTEMSLASH == "\\") {
					f = f.toLowerCase();	
				}
				if (!(f in u)) {
					u[f] = null;
					yield d;
				}
			}
		}
	},
	openFolder: function() {
		for (d in Tree.selected) {
			try {
				if (new FileFactory(d.destinationPath).exists()) {
					Utils.reveal(d.destinationFile);
				}
			}
			catch (ex) {
				Debug.log('reveal', ex);
			}
		}
	},
	openFile: function() {
		let cur = Tree.current;
		if (cur && cur.is(COMPLETE)) {
			try {
				Utils.launch(cur.destinationFile);
			}
			catch (ex) {
				Debug.log('launch', ex);
			}
		}
	},
	deleteFile: function() {
		let list = [];
		
		for (d in this._uniqueList) {
			let file = new FileFactory(d.destinationFile);
			if (file.exists()) {
				list.push(d);
			}
		}
		let msg = '';
		if (list.length < 25) {
			msg = _('deletetexts');
			for each (let d in list) {
				msg += "\n" + (new FileFactory(d.destinationFile)).leafName;
			}
		}
		else {
			msg = _('deletetextl', [list.length]);
		}
		if (list.length && Prompts.confirm(window, _('deletetitle'), msg, _('delete'), Prompts.CANCEL, null, 1)) {
			return;
		}
		for each (let d in list) {
			try {
				let file = new FileFactory(d.destinationFile);
				if (file.exists()) {
					file.remove(false);
				}
			}
			catch (ex) {
				// no-op
			}
		}
		Tree.remove(null, true);
	}
};