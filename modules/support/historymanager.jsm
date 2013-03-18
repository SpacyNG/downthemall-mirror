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
 * The Original Code is DownThemAll Private Browsing Mode compat.
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
	'getHistory'
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;
const ctor = Components.Constructor;
const Exception = Components.Exception;

let pbm = {}, prefs = {};
Cu.import("resource://dta/support/pbm.jsm", pbm);
Cu.import("resource://dta/preferences.jsm", prefs);
Cu.import("resource://dta/json.jsm");
Cu.import("resource://dta/utils.jsm");

const LocalFile = new ctor('@mozilla.org/file/local;1', 'nsILocalFile', 'initWithPath');

const validators = {
	'directory': function(s) {
		try {
			new LocalFile(s);
			return true;
		}
		catch (ex) {
			Cu.reportError(ex);
		}
		return false;
	}
};

function History(key) {
	this._key = key;
	if (key in validators) {
		this._validator = validators[key]; 
	}
	else {
		this._validator = function() true;
	}
	this._setPersisting(!pbm.browsingPrivately());
}
History.prototype = {
	_key: null,
	get key() {
		return this._key;
	},
	_sessionHistory: [],
	_persisting: true,
	get persisting() {
		return this._persisting;
	},
	_setPersisting: function(persist) {
		if (persist == this._persisting) {
			// not modified
			return;
		}
		if (!persist) {
			// need to clone
			this._sessionHistory = this.values;
		}			
		this._persisting = !!persist;
	},
	get _values() {
		if (!this._persisting) {
			return this._sessionHistory;
		}
		let json = prefs.getExt(this._key, '[]');
		let rv = [];
		try {
			rv = parse(json);
		}
		catch (ex) {
			Debug.log("Histories: Parsing of history failed: " + json, ex);
		}
		if (!rv.length) {
			try {
				rv = parse(prefs.getExt(this._key + ".default", '[]'));
			}
			catch (ex) {
				Debug.log("Cannot apply default values", ex);
			}
		}
		return rv;
	},
	get values() {
		return this._values.filter(this._validator);
	},
	_setValues: function(values) {
		if (!this._persisting) {
			Debug.logString("Set session history for " + this._key);
			this._sessionHistory = values;
		}
		else {
			try {
				prefs.setExt(this._key, stringify(values));
				Debug.logString("Set normal history for " + this._key);
			}
			catch (ex) {
				Debug.log("Histories: Setting values failed" + values, ex);
				throw ex;
			}
		}
	},
	push: function(value) {
		try {
			value = value.toString();
			let values = this._values.filter(function(e) e != value);
			values.unshift(value);
			let max = prefs.getExt('history', 5);
			Debug.logString("Histories: " + this._key + ", before " + values.toSource());
			Debug.logString("Histories: " + this._key + ", max " + max);
			while (values.length > max) {
				values.pop();
			}
			Debug.logString("Histories: " + this._key + ", after" + values.toSource());
			this._setValues(values);
		}
		catch (ex) {
			Debug.log("Histories: Push failed!", ex);
		}
	},
	reset: function(value) {
		Debug.logString("Histories: Reset called");
		this._setValues([]);
	}
};

const _histories = {};

const callbacks = {
	enterPrivateBrowsing: function() {
		Debug.logString("entering pbm: switching to session histories");
		for each (let h in _histories) {
			h._setPersisting(false);
		}
	},
	exitPrivateBrowsing: function() {
		Debug.logString("exiting pbm: switching to persisted histories");
		for each (let h in _histories) {
			h._setPersisting(true);
		}
	}
};
pbm.registerCallbacks(callbacks);

/**
 * Gets the History Instance for a key
 * @param key History to get
 * @return
 */
function getHistory(key) {
	if (!(key in _histories)) {
		return (_histories[key] = new History(key));
	}
	return _histories[key];
}