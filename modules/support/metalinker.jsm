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
 * The Original Code is DownThemAll Metalinker module.
 *
 * The Initial Developer of the Original Code is Nils Maier
 * Portions created by the Initial Developer are Copyright (C) 2010
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

const EXPORTED_SYMBOLS = [
	"parse",
	"Metalink",
	"NS_DTA",
	"NS_HTML",
	"NS_METALINKER3",
	"NS_METALINK_RFC5854",
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;
const Ctor = Components.Constructor;
const module = Cu.import;
const Exception = Components.Exception;

/**
 * Metalinker3 namespace
 */
const NS_METALINKER3 = 'http://www.metalinker.org/';
/**
 * Metalinker 4 namespace
 */
const NS_METALINK_RFC5854 = 'urn:ietf:params:xml:ns:metalink';

const Preferences = {}, DTA = {};
module("resource://dta/preferences.jsm", Preferences);
module("resource://dta/api.jsm", DTA);
module("resource://dta/version.jsm");
module("resource://dta/utils.jsm");
module("resource://dta/support/urlmanager.jsm");

const IOService = DTA.IOService;
const XPathResult = Ci.nsIDOMXPathResult;

if (!('XMLHttpRequest' in this)) {
	this.XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");
}

/**
 * Parsed Metalink representation
 * (Do not construct yourself unless you know what you're doing)
 */
function Metalink(downloads, info, parser) {
	this.downloads = downloads;
	this.info = info;
	this.parser = parser;
}
Metalink.prototype = {
	/**
	 * Array of downloads
	 */
	downloads: [],
	/**
	 * Dict of general information
	 */
	info: {},
	/**
	 * Parser identifaction
	 */
	parser: ""
};

function Base(doc, NS) {
	this._doc = doc;
	this._NS = NS;
}
Base.prototype = {
	lookupNamespaceURI: function Base_lookupNamespaceURI(prefix) {
		switch (prefix) {
		case 'html':
			return NS_HTML;
		case 'dta':
			return NS_DTA;
		}
		return this._NS;
	},
	getNodes: function (elem, query) {
		let rv = [];
		let iterator = this._doc.evaluate(
			query,
			elem,
			this,
			XPathResult.ORDERED_NODE_ITERATOR_TYPE,
			null
		);
		for (let n = iterator.iterateNext(); n; n = iterator.iterateNext()) {
			rv.push(n);
		}
		return rv;
	},
	getNode: function Base_getNode(elem, query) {
		let r = this.getNodes(elem, query);
		if (r.length) {
			return r.shift();
		}
		return null;
	},
	getSingle: function BasegetSingle(elem, query) {
		let rv = this.getNode(elem, 'ml:' + query);
		return rv ? rv.textContent.trim() : '';
	},
	getLinkRes: function BasegetLinkRes(elem, query) {
		let rv = this.getNode(elem, 'ml:' + query);
		if (rv) {
			let n = this.getSingle(rv, 'name'), l = this.checkURL(this.getSingle(rv, 'url'));
			if (n && l) {
				return [n, l];
			}
		}
		return null;
	},
	checkURL: function Base_checkURL(url, allowed) {
		if (!url) {
			return null;
		}
		try {
			url = IOService.newURI(url, this._doc.characterSet, null);
			if (url.scheme == 'file') {
				throw new Exception("file protocol invalid!");
			}
			// check for some popular bad links :p
			if (['http', 'https', 'ftp'].indexOf(url.scheme) == -1 || url.host.indexOf('.') == -1) {
				if (!(allowed instanceof Array)) {
					throw new Exception("bad link!");
				}
				if (allowed.indexOf(url.scheme) == -1) {
						throw new Exception("not allowed!");
					}
			}
			return url.spec;
		}
		catch (ex) {
			Debug.log("checkURL: failed to parse " + url, ex);
			// no-op
		}
		return null;
	}
};

/**
 * Metalink3 Parser
 * @param doc document to parse
 * @return Metalink
 */
function Metalinker3(doc) {
	let root = doc.documentElement;
	if (root.nodeName != 'metalink' || root.getAttribute('version') != '3.0') {
		throw new Exception('mlinvalid');
	}
	Base.call(this, doc, NS_METALINKER3);
}
Metalinker3.prototype = {
	__proto__: Base.prototype,
	parse: function ML3_parse(aReferrer) {
		if (aReferrer && 'spec' in aReferrer) {
			aReferrer = aReferrer.spec;
		}

		let doc = this._doc;
		let root = doc.documentElement;
		let downloads = [];

		let files = this.getNodes(doc, '//ml:files/ml:file');
		for each (let file in files) {
			let fileName = file.getAttribute('name');
			if (!fileName) {
				throw new Exception("File name not provided!");
			}
			let referrer = null;
			if (file.hasAttributeNS(NS_DTA, 'referrer')) {
				referrer = file.getAttributeNS(NS_DTA, 'referrer');
			}
			else {
				referrer = aReferrer;
			}
			let num = null;
			if (file.hasAttributeNS(NS_DTA, 'num')) {
				try {
					num = parseInt(file.getAttributeNS(NS_DTA, 'num'));
				}
				catch (ex) {
					/* no-op */
				}
			}
			if (!num) {
				num = DTA.currentSeries();
			}
			let startDate = new Date();
			if (file.hasAttributeNS(NS_DTA, 'startDate')) {
				try {
					startDate = new Date(parseInt(file.getAttributeNS(NS_DTA, 'startDate')));
				}
				catch (ex) {
					/* no-op */
				}
			}

			let urls = [];
			let urlNodes = this.getNodes(file, 'ml:resources/ml:url');
			for each (var url in urlNodes) {
				let preference = 1;
				let charset = doc.characterSet;
				if (url.hasAttributeNS(NS_DTA, 'charset')) {
					charset = url.getAttributeNS(NS_DTA, 'charset');
				}

				let uri = null;
				try {
					if (url.hasAttribute('type') && !url.getAttribute('type').match(/^(?:https?|ftp)$/i)) {
						throw new Exception("Invalid url type");
					}
					uri = this.checkURL(url.textContent.trim());
					if (!uri) {
						throw new Exception("Invalid url");
					}
					uri = IOService.newURI(uri, charset, null);
				}
				catch (ex) {
					Debug.log("Failed to parse URL" + url.textContent, ex);
					continue;
				}

				if (url.hasAttribute('preference')) {
					var a = parseInt(url.getAttribute('preference'));
					if (isFinite(a) && a > 0 && a < 101) {
						preference = a;
					}
				}
				if (url.hasAttribute('location')) {
					var a = url.getAttribute('location').slice(0,2).toLowerCase();
					if (Version.LOCALE.indexOf(a) != -1) {
						preference = 100 + preference;
					}
				}
				urls.push(new DTA.URL(uri, preference));
			}
			if (!urls.length) {
				continue;
			}
			let hash = null;
			for each (let h in this.getNodes(file, 'ml:verification/ml:hash')) {
				try {
					h = new DTA.Hash(h.textContent.trim(), h.getAttribute('type'));
					if (!hash || hash.q < h.q) {
						hash = h;
					}
				}
				catch (ex) {
					Debug.log("Failed to parse hash: " + h.textContent.trim() + "/" + h.getAttribute('type'), ex);
				}
			}
			if (hash) {
				hash = new DTA.HashCollection(hash);
				let pieces = this.getNodes(file, 'ml:verification/ml:pieces');
				if (pieces.length) {
					pieces = pieces[0];
					let type = pieces.getAttribute('type').trim();
					try {
						hash.parLength = parseInt(pieces.getAttribute('length'));
						if (!isFinite(hash.parLength) || hash.parLength < 1) {
							throw new Exception("Invalid pieces length");
						}
						let collection = [];
						for each (let piece in this.getNodes(pieces, 'ml:hash')) {
							try {
								collection.push({
									piece: parseInt(piece.getAttribute('piece')),
									hash: new DTA.Hash(piece.textContent.trim(), type)
								});
							}
							catch (ex) {
								Debug.log("Failed to parse piece", ex);
								throw ex;
							}
						}
						collection.sort(function(a, b) a.piece - b.piece);
						for each (let piece in collection) {
							hash.add(piece.hash);
						}
						if (size && hash.parLength * hash.partials.length < size) {
							throw Exception("too few partials");
						}
						Debug.logString("loaded " + hash.partials.length + " partials");
					}
					catch (ex) {
						Debug.log("Failed to parse pieces", ex);
						hash = new DTA.HashCollection(hash.full);
					}
				}
			}
			let desc = this.getSingle(file, 'description');
			if (!desc) {
				desc = this.getSingle(root, 'description');
			}
			let size = this.getSingle(file, 'size');
			size = parseInt(size);
			if (!isFinite(size)) {
				size = 0;
			}
			downloads.push({
				'url': new UrlManager(urls),
				'fileName': fileName,
				'referrer': referrer ? referrer : null,
				'numIstance': num,
				'title': '',
				'description': desc,
				'startDate': startDate,
				'hashCollection': hash,
				'license': this.getLinkRes(file, "license"),
				'publisher': this.getLinkRes(file, "publisher"),
				'identity': this.getSingle(file, 'identity'),
				'copyright': this.getSingle(file, 'copyright'),
				'size': size,
				'version': this.getSingle(file, 'version'),
				'logo': this.checkURL(this.getSingle(file, 'logo', ['data'])),
				'lang': this.getSingle(file, 'language'),
				'sys': this.getSingle(file, 'os'),
				'mirrors': urls.length,
				'selected': true,
				'fromMetalink': true
			});
		}
		let info = {
			'identity': this.getSingle(root, 'identity'),
			'description': this.getSingle(root, 'description'),
			'logo': this.checkURL(this.getSingle(root, 'logo', ['data'])),
			'license': this.getLinkRes(root, "license"),
			'publisher': this.getLinkRes(root, "publisher"),
			'start': false
		};
		return new Metalink(downloads, info, "Metalinker Version 3.0");
	}
};

/**
 * Metalink RFC5854 (IETF) Parser
 * @param doc document to parse
 * @return Metalink
 */
function MetalinkerRFC5854(doc) {
	let root = doc.documentElement;
	if (root.nodeName != 'metalink' || root.namespaceURI != NS_METALINK_RFC5854 ) {
		Debug.logString(root.nodeName + "\nns:" + root.namespaceURI);
		throw new Exception('mlinvalid');
	}
	Base.call(this, doc, NS_METALINK_RFC5854);
}
MetalinkerRFC5854.prototype = {
	__proto__: Base.prototype,
	parse: function ML4_parse(aReferrer) {
		if (aReferrer && 'spec' in aReferrer) {
			aReferrer = aReferrer.spec;
		}

		let doc = this._doc;
		let root = doc.documentElement;
		let downloads = [];

		let files = this.getNodes(doc, '/ml:metalink/ml:file');
		for each (let file in files) {
			let fileName = file.getAttribute('name');
			if (!fileName) {
				throw new Exception("File name not provided!");
			}
			let referrer = null;
			if (file.hasAttributeNS(NS_DTA, 'referrer')) {
				referrer = file.getAttributeNS(NS_DTA, 'referrer');
			}
			else {
				referrer = aReferrer;
			}
			let num = null;
			if (file.hasAttributeNS(NS_DTA, 'num')) {
				try {
					num = parseInt(file.getAttributeNS(NS_DTA, 'num'));
				}
				catch (ex) {
					/* no-op */
				}
			}
			if (!num) {
				num = DTA.currentSeries();
			}
			let startDate = new Date();
			if (file.hasAttributeNS(NS_DTA, 'startDate')) {
				try {
					startDate = new Date(parseInt(file.getAttributeNS(NS_DTA, 'startDate')));
				}
				catch (ex) {
					/* no-op */
				}
			}

			let urls = [];
			let urlNodes = this.getNodes(file, 'ml:url');
			for each (var url in urlNodes) {
				let preference = 1;
				let charset = doc.characterSet;
				if (url.hasAttributeNS(NS_DTA, 'charset')) {
					charset = url.getAttributeNS(NS_DTA, 'charset');
				}

				let uri = null;
				try {
					uri = this.checkURL(url.textContent.trim());
					if (!uri) {
						throw new Exception("Invalid url");
					}
					uri = IOService.newURI(uri, charset, null);
				}
				catch (ex) {
					Debug.log("Failed to parse URL" + url.textContent, ex);
					continue;
				}

				if (url.hasAttribute('priority')) {
					let a = parseInt(url.getAttribute('priority'));
					if (a > 0) {
						preference = a;
					}
				}
				if (url.hasAttribute('location')) {
					let a = url.getAttribute('location').slice(0,2).toLowerCase();
					if (Version.LOCALE.indexOf(a) != -1) {
						preference = Math.max(preference / 4, 1);
					}
				}
				urls.push(new DTA.URL(uri, preference));
			}
			if (!urls.length) {
				continue;
			}
			// normalize preferences
			let pmax = urls.reduce(function(p,c) isFinite(c.preference) ? Math.max(c.preference, p) : p, 1)
			let pmin = urls.reduce(function(p,c) isFinite(c.preference) ? Math.min(c.preference, p) : p, pmax - 1);
			urls.forEach(function(url) {
				url.preference = Math.max(100 - ((url.preference - pmin) *  100 / (pmax - pmin)).toFixed(0), 10);
			});

			let hash = null;
			for each (let h in this.getNodes(file, 'ml:hash')) {
				try {
					h = new DTA.Hash(h.textContent.trim(), h.getAttribute('type'));
					if (!hash || hash.q < h.q) {
						hash = h;
					}
				}
				catch (ex) {
					Debug.log("Failed to parse hash: " + h.textContent.trim() + "/" + h.getAttribute('type'), ex);
				}
			}
			if (hash) {
				hash = new DTA.HashCollection(hash);
				let pieces = this.getNodes(file, 'ml:pieces');
				if (pieces.length) {
					pieces = pieces[0];
					let type = pieces.getAttribute('type').trim();
					try {
						hash.parLength = parseInt(pieces.getAttribute('length'));
						if (!isFinite(hash.parLength) || hash.parLength < 1) {
							throw new Exception("Invalid pieces length");
						}
						for each (let piece in this.getNodes(pieces, 'ml:hash')) {
							try {
								hash.add(new DTA.Hash(piece.textContent.trim(), type));
							}
							catch (ex) {
								Debug.log("Failed to parse piece", ex);
								throw ex;
							}
						}
						if (size && hash.parLength * hash.partials.length < size) {
							throw Exception("too few partials");
						}
						Debug.logString("loaded " + hash.partials.length + " partials");
					}
					catch (ex) {
						Debug.log("Failed to parse pieces", ex);
						hash = new DTA.HashCollection(hash.full);
					}
				}
			}

			let desc = this.getSingle(file, 'description');
			if (!desc) {
				desc = this.getSingle(root, 'description');
			}
			let size = this.getSingle(file, 'size');
			size = parseInt(size);
			if (!isFinite(size)) {
				size = 0;
			}
			downloads.push({
				'url': new UrlManager(urls),
				'fileName': fileName,
				'referrer': referrer ? referrer : null,
				'numIstance': num,
				'title': '',
				'description': desc,
				'startDate': startDate,
				'hashCollection': hash,
				'license': this.getLinkRes(file, "license"),
				'publisher': this.getLinkRes(file, "publisher"),
				'identity': this.getSingle(file, "identity"),
				'copyright': this.getSingle(file, "copyright"),
				'size': size,
				'version': this.getSingle(file, "version"),
				'logo': this.checkURL(this.getSingle(file, "logo", ['data'])),
				'lang': this.getSingle(file, "language"),
				'sys': this.getSingle(file, "os"),
				'mirrors': urls.length,
				'selected': true,
				'fromMetalink': true
			});
		}
		let info = {
			'identity': this.getSingle(root, "identity"),
			'description': this.getSingle(root, "description"),
			'logo': this.checkURL(this.getSingle(root, "logo", ['data'])),
			'license': this.getLinkRes(root, "license"),
			'publisher': this.getLinkRes(root, "publisher"),
			'start': false
		};
		return new Metalink(downloads, info, "Metalinker Version 4.0 (RFC5854/IETF)");
	}
};

const __parsers__ = [
	Metalinker3,
	MetalinkerRFC5854
];

/**
 * Parse a metalink
 * @param aFile (nsIFile) Metalink file
 * @param aReferrer (String) Optional. Referrer
 * @param aCallback (Function) Receiving callback function of form f(result, exception || null)
 * @return async (Metalink) Parsed metalink data
 */
function parse(aFile, aReferrer, aCallback) {
	let fu = IOService.newFileURI(aFile);
	let xhrLoad, xhrError;
	let xhr = new XMLHttpRequest();
	xhr.open("GET", fu.spec);
	xhr.overrideMimeType("application/xml");
	xhr.addEventListener("load", xhrLoad = (function() {
		xhr.removeEventListener("load", xhrLoad, false);
		xhr.removeEventListener("error", xhrError, false);

		try {
			let doc = xhr.responseXML;
			if (doc.documentElement.nodeName == 'parsererror') {
				throw new Exception("Failed to parse XML");
			}
			for each (let parser in __parsers__) {
				try {
					parser = new parser(doc);
				}
				catch (ex) {
					Debug.log(parser.name + " failed", ex);
					continue;
				}
				aCallback(parser.parse(aReferrer));
				return;
			}
			throw new Exception("no suitable parser found!");
		}
		catch (ex) {
			aCallback(null, ex);
		}
	}), false);
	xhr.addEventListener("error", xhrError = (function() {
		xhr.removeEventListener("load", xhrLoad, false);
		xhr.removeEventListener("error", xhrError, false);

		aCallback(null, new Exception("failed to load"));
	}), false);
	xhr.send();
}