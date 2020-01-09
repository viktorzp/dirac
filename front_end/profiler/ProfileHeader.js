// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @unrestricted
 */
export default class ProfileHeader extends Common.Object {
  /**
   * @param {!Profiler.ProfileType} profileType
   * @param {string} title
   */
  constructor(profileType, title) {
    super();
    this._profileType = profileType;
    this.title = title;
    this.uid = profileType.incrementProfileUid();
    this._fromFile = false;
  }

  /**
   * @param {string} title
   */
  setTitle(title) {
    this.title = title;
    this.dispatchEventToListeners(Events.ProfileTitleChanged, this);
  }

  /**
   * @return {!Profiler.ProfileType}
   */
  profileType() {
    return this._profileType;
  }

  /**
   * @param {?string} subtitle
   * @param {boolean=} wait
   */
  updateStatus(subtitle, wait) {
    this.dispatchEventToListeners(Events.UpdateStatus, new StatusUpdate(subtitle, wait));
  }

  /**
   * Must be implemented by subclasses.
   * @param {!Profiler.ProfileType.DataDisplayDelegate} dataDisplayDelegate
   * @return {!Profiler.ProfileSidebarTreeElement}
   */
  createSidebarTreeElement(dataDisplayDelegate) {
    throw new Error('Not implemented.');
  }

  /**
   * @param {!Profiler.ProfileType.DataDisplayDelegate} dataDisplayDelegate
   * @return {!UI.Widget}
   */
  createView(dataDisplayDelegate) {
    throw new Error('Not implemented.');
  }

  removeTempFile() {
    if (this._tempFile) {
      this._tempFile.remove();
    }
  }

  dispose() {
  }

  /**
   * @return {boolean}
   */
  canSaveToFile() {
    return false;
  }

  saveToFile() {
    throw new Error('Not implemented');
  }

  /**
   * @param {!File} file
   * @return {!Promise<?Error|?FileError>}
   */
  loadFromFile(file) {
    throw new Error('Not implemented');
  }

  /**
   * @return {boolean}
   */
  fromFile() {
    return this._fromFile;
  }

  setFromFile() {
    this._fromFile = true;
  }

  /**
   * @param {!Protocol.Profiler.Profile} profile
   */
  setProfile(profile) {
  }
}

/**
 * @unrestricted
 */
export class StatusUpdate {
  /**
   * @param {?string} subtitle
   * @param {boolean|undefined} wait
   */
  constructor(subtitle, wait) {
    /** @type {?string} */
    this.subtitle = subtitle;
    /** @type {boolean|undefined} */
    this.wait = wait;
  }
}

/** @enum {symbol} */
export const Events = {
  UpdateStatus: Symbol('UpdateStatus'),
  ProfileReceived: Symbol('ProfileReceived'),
  ProfileTitleChanged: Symbol('ProfileTitleChanged')
};

/* Legacy exported object */
self.Profiler = self.Profiler || {};

/* Legacy exported object */
Profiler = Profiler || {};

/** @constructor */
Profiler.ProfileHeader = ProfileHeader;

/** @constructor */
Profiler.ProfileHeader.StatusUpdate = StatusUpdate;

/** @enum {symbol} */
Profiler.ProfileHeader.Events = Events;
