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
 * The Original Code is DownThemAll.
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

const Prompts = require("prompts");
const Version = require("version");
const {isWindowPrivate} = require("support/pbm");

var dropDowns = {};

XPCOMUtils.defineLazyGetter(this, "BatchGenerator", function() {
	const {BatchGenerator} = require("support/batchgen");
	return BatchGenerator;
});


var Dialog = {
	load: function DTA_load() {
		try {
			this.ddDirectory = $("directory");
			if (!this.ddDirectory.value) {
				log(LOG_DEBUG, "Using default download directory, value was " + this.ddDirectory.value);
				this.ddDirectory.value = DefaultDownloadsDirectory.path;
			}
			this.ddRenaming = $("renaming");
			var address = $('address');
			(function() {
				let menu = document.getAnonymousElementByAttribute(
					address,
					"anonid",
					"textbox-input-box"
					);
				if (!menu) {
					return;
				}

				menu = document.getAnonymousElementByAttribute(
						menu,
					"anonid",
					"input-box-contextmenu"
					);
				if (!menu) {
					return;
				}

				let batches = $("batches");
				let nodes = Array.slice(batches.childNodes);
				for (let n of nodes) {
					menu.appendChild(n);
				}
				menu.addEventListener("popupshowing", function() {
					let hidden = true;
					if (address.selectionStart != -1) {
						let text = address.value.substring(address.selectionStart, address.selectionEnd);
						hidden = !/^\d+$/.test(text);
					}
					for (let n of nodes) {
						n.hidden = hidden
					}
				}, false);
				$("create-batch-descriptor").addEventListener("command", function() {
					let {selectionStart, selectionEnd} = address;
					let value = address.value;
					let text = value.substring(selectionStart, selectionEnd);
					let start = "1";
					while (start.length < text.length) {
						start = "0" + start;
					}
					text = "[" + start + ":" + text + "]";
					address.value = value.substring(0, selectionStart)
						+ text
						+ value.substring(selectionEnd, value.length);
					address.setSelectionRange(selectionStart + 1, selectionEnd + 1);
				}, false);
			})();

			var hash = null;
			if (window.arguments) {
				var a = window.arguments[0];
				var url = a.url;
				if (!('url' in a))
					;
				else if (typeof(a.url) == 'string') {
					address.value = a.url;
				}
				else if (typeof(a.url) == 'object' && 'url' in a.url) {
					address._item = a;
					// we've got a DTA.URL.
					// In this case it is not safe to modify it because of encoding
					// issues.
					address.value = a.url.usable;
					if ("fileName" in a) {
						address.value += " (" + a.fileName + ")";
					}
					address.readOnly = true;
					$('batcheslabel').style.display = 'none';
					$('batches').collapsed = true;
					hash = a.url.hash;
				}
				try {
					let referrer = (new DTA.URL(Services.io.newURI(a.referrer, null, null))).url.spec;
					try {
						referrer = decodeURIComponent(referrer);
					} catch (ex) {}
					$("URLref").value	= referrer;
				}
				catch (ex) {
					// no op
				}
				if (a.mask) {
					this.ddRenaming.value = a.mask;
				}
				$('description').value = a.description;
			}
			// check if there's some URL in clipboard
			else {
				let trans = new Instances.Transferable();
				try {
					trans.addDataFlavor("text/unicode");
					Services.clipbrd.getData(trans, Services.clipbrd.kGlobalClipboard);

					let str = {}, length = {};
					trans.getTransferData(
						"text/unicode",
						str,
						length
					);
					if (length.value && (str.value instanceof Ci.nsISupportsString)) {
						let url = new DTA.URL(Services.io.newURI(str.value.data, null, null));
						if (url.hash) {
							hash = url.hash;
							delete url.hash;
						}
						address.value = url.url.spec;
						address.select();
					}
				}
				catch (ex) {
					log(LOG_DEBUG, "Not able to gather data from the clipboard!", ex);
				}
			}
			if (hash) {
				$('hash').value = hash;
			}
			sizeToContent();
		}
		catch(ex) {
			log(LOG_ERROR, "load():", ex);
		}
	},
	download: function DTA_download(start) {

		var errors = [];

		// check the directory
		var dir = this.ddDirectory.value.trim();
		dir = this.ddDirectory.value = !!dir ? Utils.addFinalSlash(dir) : '';
		if (!dir.length || !Utils.validateDir(dir)) {
			errors.push('directory');
		}

		// check mask
		var mask = this.ddRenaming.value.trim();
		mask = this.ddRenaming.value = mask || '';
		if (!mask.length) {
			errors.push('renaming');
		}

		var address = $('address');
		var hasItem = ("_item" in address);
		var url = null;
		if (!hasItem) {
			url = address.value;
			try {
				if (url == '') {
					throw new Components.Exception("Empty url");
				}
				let uri = Services.fixups.createFixupURI(url, 0);
				try {
					url = decodeURIComponent(uri.spec);
				}
				catch (ex) {
					url = uri.spec;
				}
				url = new DTA.URL(Services.io.newURI(url, null, null));
				if (url.hash) {
					$('hash').value = hash;
				}
				address.value = url;
			}
			catch (ex) {
				errors.push('address');
			}
		}

		var hash = null;
		if (!$('hash').isValid) {
			errors.push('hash');
		}
		else {
			hash = $('hash').value;
		}

		$('directory', 'renaming', 'address', 'hash').forEach(
			function(e) {
				// reset the styles
				if (e.hasAttribute('error')) {
					e.removeAttribute('error');
				}
			}
		);

		if (errors.length) {
			errors.forEach(
				function(e) {
					$(e).setAttribute('error', 'true');
				}
			);
			return false;
		}

		if (hasItem) {
			return this.downloadItem(start);
		}
		return this.downloadPlain(start, url, hash);
	},
	downloadPlain: function(start, url, hash) {
		let num = DTA.currentSeries();
		try {
			var batch = new BatchGenerator(url);
		}
		catch (ex) {
			log(LOG_ERROR, "Cannot create batch", ex);
			return false;
		}

		var rv = batch.length > 1;
		if (rv) {
			var message = _(
				'batchtasks',
				[batch.length, batch.parts, batch.first, batch.last]
			);
			if (batch.length > 1000) {
				message += _('manytasks');
			}
			rv = Prompts.confirm(window, _('batchtitle'), message, _('batchdownload'), Prompts.CANCEL, _('singledownload'));
			if (rv == 1) {
				return false;
			}
			rv = rv == 0;
		}

		let mask = this.ddRenaming.value;
		let dir = this.ddDirectory.value;
		let isPrivate = isWindowPrivate(window.opener);

		let downloads = (function() {
			let desc = $('description').value;
			let ref = $('URLref').value;
			let URL = DTA.URL;
			let newURI = Services.io.newURI;

			function QueueItem(url, fn) {
				this.url = new URL(newURI(url, null, null));
				if (fn) {
					this.fileName = fn;
				}
				if (!rv && hash) {
					this.url.hash = hash;
				}
			}
			QueueItem.prototype = {
				description: desc,
				referrer: $('URLref').value,
				numIstance: num,
				mask: mask,
				dirSave: dir,
				isPrivate: isPrivate
			};

			if (rv) {
				return (new QueueItem(i) for (i in  batch.getURLs()));
			}

			return batch = [new QueueItem(url)];
		})();
		return this.sendDownloads(start, downloads, isPrivate);
	},
	downloadItem: function(start) {
		let item = $("address")._item;
		item.description = $('description').value;
		item.referrer = $('URLref').value;
		item.numIstance = DTA.currentSeries();
		item.mask = this.ddRenaming.value;
		item.dirSave = this.ddDirectory.value;

		return this.sendDownloads(start, [item], item.isPrivate);
	},
	sendDownloads: function(start, downloads, isPrivate) {
		DTA.sendLinksToManager(window, start, downloads);

		DTA.incrementSeries();
		Preferences.setExt("lastqueued", !start);

		if (!isPrivate) {
			this.ddRenaming.save($("renamingOnce").checked);
			this.ddDirectory.save();
		}

		self.close();

		return false;
	},
	browseDir: function DTA_browseDir() {
		// let's check and create the directory
		Utils.askForDir(
			this.ddDirectory.value,
			_("validdestination"),
			function (newDir) {
				if (newDir) {
					Dialog.ddDirectory.value = newDir;
				}
			});
	}
}

unloadWindow(window, function() {
	log(LOG_DEBUG, "closed an addurl window");
	close();
});
