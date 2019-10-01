// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/** @enum {symbol} */
export const Events = {
  AppendedToURL: Symbol('appendedToURL'),
  CanceledSaveURL: Symbol('canceledSaveURL'),
  ContextMenuCleared: Symbol('contextMenuCleared'),
  ContextMenuItemSelected: Symbol('contextMenuItemSelected'),
  DeviceCountUpdated: Symbol('deviceCountUpdated'),
  DevicesDiscoveryConfigChanged: Symbol('devicesDiscoveryConfigChanged'),
  DevicesPortForwardingStatusChanged: Symbol('devicesPortForwardingStatusChanged'),
  DevicesUpdated: Symbol('devicesUpdated'),
  DispatchMessage: Symbol('dispatchMessage'),
  DispatchMessageChunk: Symbol('dispatchMessageChunk'),
  EnterInspectElementMode: Symbol('enterInspectElementMode'),
  EyeDropperPickedColor: Symbol('eyeDropperPickedColor'),
  FileSystemsLoaded: Symbol('fileSystemsLoaded'),
  FileSystemRemoved: Symbol('fileSystemRemoved'),
  FileSystemAdded: Symbol('fileSystemAdded'),
  FileSystemFilesChangedAddedRemoved: Symbol('FileSystemFilesChangedAddedRemoved'),
  IndexingTotalWorkCalculated: Symbol('indexingTotalWorkCalculated'),
  IndexingWorked: Symbol('indexingWorked'),
  IndexingDone: Symbol('indexingDone'),
  KeyEventUnhandled: Symbol('keyEventUnhandled'),
  ReloadInspectedPage: Symbol('reloadInspectedPage'),
  RevealSourceLine: Symbol('revealSourceLine'),
  SavedURL: Symbol('savedURL'),
  SearchCompleted: Symbol('searchCompleted'),
  SetInspectedTabId: Symbol('setInspectedTabId'),
  SetUseSoftMenu: Symbol('setUseSoftMenu'),
  ShowPanel: Symbol('showPanel')
};

export const EventDescriptors = [
  [Events.AppendedToURL, 'appendedToURL', ['url']],
  [Events.CanceledSaveURL, 'canceledSaveURL', ['url']],
  [Events.ContextMenuCleared, 'contextMenuCleared', []],
  [Events.ContextMenuItemSelected, 'contextMenuItemSelected', ['id']],
  [Events.DeviceCountUpdated, 'deviceCountUpdated', ['count']],
  [Events.DevicesDiscoveryConfigChanged, 'devicesDiscoveryConfigChanged', ['config']],
  [Events.DevicesPortForwardingStatusChanged, 'devicesPortForwardingStatusChanged', ['status']],
  [Events.DevicesUpdated, 'devicesUpdated', ['devices']],
  [Events.DispatchMessage, 'dispatchMessage', ['messageObject']],
  [Events.DispatchMessageChunk, 'dispatchMessageChunk', ['messageChunk', 'messageSize']],
  [Events.EnterInspectElementMode, 'enterInspectElementMode', []],
  [Events.EyeDropperPickedColor, 'eyeDropperPickedColor', ['color']],
  [Events.FileSystemsLoaded, 'fileSystemsLoaded', ['fileSystems']],
  [Events.FileSystemRemoved, 'fileSystemRemoved', ['fileSystemPath']],
  [Events.FileSystemAdded, 'fileSystemAdded', ['errorMessage', 'fileSystem']],
  [Events.FileSystemFilesChangedAddedRemoved, 'fileSystemFilesChangedAddedRemoved', ['changed', 'added', 'removed']],
  [Events.IndexingTotalWorkCalculated, 'indexingTotalWorkCalculated', ['requestId', 'fileSystemPath', 'totalWork']],
  [Events.IndexingWorked, 'indexingWorked', ['requestId', 'fileSystemPath', 'worked']],
  [Events.IndexingDone, 'indexingDone', ['requestId', 'fileSystemPath']],
  [Events.KeyEventUnhandled, 'keyEventUnhandled', ['event']],
  [Events.ReloadInspectedPage, 'reloadInspectedPage', ['hard']],
  [Events.RevealSourceLine, 'revealSourceLine', ['url', 'lineNumber', 'columnNumber']],
  [Events.SavedURL, 'savedURL', ['url', 'fileSystemPath']],
  [Events.SearchCompleted, 'searchCompleted', ['requestId', 'fileSystemPath', 'files']],
  [Events.SetInspectedTabId, 'setInspectedTabId', ['tabId']],
  [Events.SetUseSoftMenu, 'setUseSoftMenu', ['useSoftMenu']],
  [Events.ShowPanel, 'showPanel', ['panelName']]
];

/* Legacy exported object */
self.Host = self.Host || {};

/* Legacy exported object */
Host = Host || {};

Host.InspectorFrontendHostAPI = {};

Host.InspectorFrontendHostAPI.Events = Events;
Host.InspectorFrontendHostAPI.EventDescriptors = EventDescriptors;