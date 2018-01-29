/*
 * Copyright (C) 2007 Apple Inc.  All rights reserved.
 * Copyright (C) 2009 Joseph Pecoraro
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

Elements.StylesSidebarPane = class extends Elements.ElementsSidebarPane {
  constructor() {
    super();
    this.setMinimumSize(96, 26);
    this.registerRequiredCSS('elements/stylesSidebarPane.css');
    this.element.tabIndex = -1;

    Common.moduleSetting('colorFormat').addChangeListener(this.update.bind(this));
    Common.moduleSetting('textEditorIndent').addChangeListener(this.update.bind(this));

    /** @type {?UI.Widget} */
    this._currentToolbarPane = null;
    /** @type {?UI.Widget} */
    this._animatedToolbarPane = null;
    /** @type {?UI.Widget} */
    this._pendingWidget = null;
    /** @type {?UI.ToolbarToggle} */
    this._pendingWidgetToggle = null;
    this._toolbarPaneElement = this._createStylesSidebarToolbar();

    this._sectionsContainer = this.contentElement.createChild('div');
    UI.ARIAUtils.markAsTree(this._sectionsContainer);
    this._sectionsContainer.addEventListener('keydown', this._sectionsContainerKeyDown.bind(this), false);
    this._sectionsContainer.addEventListener('focusin', this._sectionsContainerFocusChanged.bind(this), false);
    this._sectionsContainer.addEventListener('focusout', this._sectionsContainerFocusChanged.bind(this), false);

    this._swatchPopoverHelper = new InlineEditor.SwatchPopoverHelper();
    this._linkifier = new Components.Linkifier(Elements.StylesSidebarPane._maxLinkLength, /* useLinkDecorator */ true);
    /** @type {?Elements.StylePropertyHighlighter} */
    this._decorator = null;
    this._userOperation = false;
    this._isEditingStyle = false;
    /** @type {?RegExp} */
    this._filterRegex = null;

    this.contentElement.classList.add('styles-pane');

    /** @type {!Array<!Elements.SectionBlock>} */
    this._sectionBlocks = [];
    Elements.StylesSidebarPane._instance = this;
    UI.context.addFlavorChangeListener(SDK.DOMNode, this.forceUpdate, this);
    this.contentElement.addEventListener('copy', this._clipboardCopy.bind(this));
    this._resizeThrottler = new Common.Throttler(100);
  }

  /**
   * @return {!InlineEditor.SwatchPopoverHelper}
   */
  swatchPopoverHelper() {
    return this._swatchPopoverHelper;
  }

  /**
   * @param {boolean} userOperation
   */
  setUserOperation(userOperation) {
    this._userOperation = userOperation;
  }

  /**
   * @param {!SDK.CSSProperty} property
   * @return {!Element}
   */
  static createExclamationMark(property) {
    var exclamationElement = createElement('label', 'dt-icon-label');
    exclamationElement.className = 'exclamation-mark';
    if (!Elements.StylesSidebarPane.ignoreErrorsForProperty(property))
      exclamationElement.type = 'smallicon-warning';
    exclamationElement.title = SDK.cssMetadata().isCSSPropertyName(property.name) ?
        Common.UIString('Invalid property value') :
        Common.UIString('Unknown property name');
    return exclamationElement;
  }

  /**
   * @param {!SDK.CSSProperty} property
   * @return {boolean}
   */
  static ignoreErrorsForProperty(property) {
    /**
     * @param {string} string
     */
    function hasUnknownVendorPrefix(string) {
      return !string.startsWith('-webkit-') && /^[-_][\w\d]+-\w/.test(string);
    }

    var name = property.name.toLowerCase();

    // IE hack.
    if (name.charAt(0) === '_')
      return true;

    // IE has a different format for this.
    if (name === 'filter')
      return true;

    // Common IE-specific property prefix.
    if (name.startsWith('scrollbar-'))
      return true;
    if (hasUnknownVendorPrefix(name))
      return true;

    var value = property.value.toLowerCase();

    // IE hack.
    if (value.endsWith('\\9'))
      return true;
    if (hasUnknownVendorPrefix(value))
      return true;

    return false;
  }

  /**
   * @param {string} placeholder
   * @param {!Element} container
   * @param {function(?RegExp)} filterCallback
   * @param {string} activeClassName
   * @return {!Element}
   */
  static createPropertyFilterElement(placeholder, container, filterCallback, activeClassName) {
    var input = createElementWithClass('input');
    input.placeholder = placeholder;

    function searchHandler() {
      var regex = input.value ? new RegExp(input.value.escapeForRegExp(), 'i') : null;
      filterCallback(regex);
      container.classList.toggle(activeClassName, !!input.value);
    }
    input.addEventListener('input', searchHandler, false);

    /**
     * @param {!Event} event
     */
    function keydownHandler(event) {
      if (event.key !== 'Escape' || !input.value)
        return;
      event.consume(true);
      input.value = '';
      searchHandler();
    }
    input.addEventListener('keydown', keydownHandler, false);

    input.setFilterValue = setFilterValue;

    /**
     * @param {string} value
     */
    function setFilterValue(value) {
      input.value = value;
      input.focus();
      searchHandler();
    }

    return input;
  }

  /**
   * @param {!SDK.CSSProperty} cssProperty
   */
  revealProperty(cssProperty) {
    this._decorator = new Elements.StylePropertyHighlighter(this, cssProperty);
    this._decorator.perform();
    this.update();
  }

  forceUpdate() {
    this._swatchPopoverHelper.hide();
    this._resetCache();
    this.update();
  }

  /**
   * @param {!Event} event
   */
  _sectionsContainerKeyDown(event) {
    var activeElement = this._sectionsContainer.ownerDocument.deepActiveElement();
    if (!activeElement)
      return;
    var section = activeElement._section;
    if (!section)
      return;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        var sectionToFocus = section.previousSibling() || section.lastSibling();
        sectionToFocus.element.focus();
        event.consume(true);
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        var sectionToFocus = section.nextSibling() || section.firstSibling();
        sectionToFocus.element.focus();
        event.consume(true);
        break;
      case 'Home':
        section.firstSibling().element.focus();
        event.consume(true);
        break;
      case 'End':
        section.lastSibling().element.focus();
        event.consume(true);
        break;
    }
  }

  _sectionsContainerFocusChanged() {
    // When a styles section is focused, shift+tab should leave the section.
    // Leaving tabIndex = 0 on the first element would cause it to be focused instead.
    if (this._sectionBlocks[0] && this._sectionBlocks[0].sections[0])
      this._sectionBlocks[0].sections[0].element.tabIndex = this._sectionsContainer.hasFocus() ? -1 : 0;
  }

  /**
   * @param {!Event} event
   */
  _onAddButtonLongClick(event) {
    var cssModel = this.cssModel();
    if (!cssModel)
      return;
    var headers = cssModel.styleSheetHeaders().filter(styleSheetResourceHeader);

    /** @type {!Array.<{text: string, handler: function()}>} */
    var contextMenuDescriptors = [];
    for (var i = 0; i < headers.length; ++i) {
      var header = headers[i];
      var handler = this._createNewRuleInStyleSheet.bind(this, header);
      contextMenuDescriptors.push({text: Bindings.displayNameForURL(header.resourceURL()), handler: handler});
    }

    contextMenuDescriptors.sort(compareDescriptors);

    var contextMenu = new UI.ContextMenu(event);
    for (var i = 0; i < contextMenuDescriptors.length; ++i) {
      var descriptor = contextMenuDescriptors[i];
      contextMenu.defaultSection().appendItem(descriptor.text, descriptor.handler);
    }
    contextMenu.footerSection().appendItem(
        'inspector-stylesheet', this._createNewRuleInViaInspectorStyleSheet.bind(this));
    contextMenu.show();

    /**
     * @param {!{text: string, handler: function()}} descriptor1
     * @param {!{text: string, handler: function()}} descriptor2
     * @return {number}
     */
    function compareDescriptors(descriptor1, descriptor2) {
      return String.naturalOrderComparator(descriptor1.text, descriptor2.text);
    }

    /**
     * @param {!SDK.CSSStyleSheetHeader} header
     * @return {boolean}
     */
    function styleSheetResourceHeader(header) {
      return !header.isViaInspector() && !header.isInline && !!header.resourceURL();
    }
  }

  /**
   * @param {?RegExp} regex
   */
  _onFilterChanged(regex) {
    this._filterRegex = regex;
    this._updateFilter();
  }

  /**
   * @param {!Elements.StylePropertiesSection=} editedSection
   */
  _refreshUpdate(editedSection) {
    if (this._isEditingStyle)
      return;
    var node = this.node();
    if (!node)
      return;

    for (var section of this.allSections()) {
      if (section.isBlank)
        continue;
      section.update(section === editedSection);
    }

    if (this._filterRegex)
      this._updateFilter();
    this._nodeStylesUpdatedForTest(node, false);
  }

  /**
   * @override
   * @return {!Promise.<?>}
   */
  doUpdate() {
    return this._fetchMatchedCascade().then(this._innerRebuildUpdate.bind(this));
  }

  /**
   * @override
   */
  onResize() {
    this._resizeThrottler.schedule(this._innerResize.bind(this));
  }

  /**
   * @return {!Promise}
   */
  _innerResize() {
    var width = this.contentElement.getBoundingClientRect().width + 'px';
    this.allSections().forEach(section => section.propertiesTreeOutline.element.style.width = width);
    return Promise.resolve();
  }

  _resetCache() {
    if (this.cssModel())
      this.cssModel().discardCachedMatchedCascade();
  }

  /**
   * @return {!Promise.<?SDK.CSSMatchedStyles>}
   */
  _fetchMatchedCascade() {
    var node = this.node();
    if (!node || !this.cssModel())
      return Promise.resolve(/** @type {?SDK.CSSMatchedStyles} */ (null));

    return this.cssModel().cachedMatchedCascadeForNode(node).then(validateStyles.bind(this));

    /**
     * @param {?SDK.CSSMatchedStyles} matchedStyles
     * @return {?SDK.CSSMatchedStyles}
     * @this {Elements.StylesSidebarPane}
     */
    function validateStyles(matchedStyles) {
      return matchedStyles && matchedStyles.node() === this.node() ? matchedStyles : null;
    }
  }

  /**
   * @param {boolean} editing
   */
  setEditingStyle(editing) {
    if (this._isEditingStyle === editing)
      return;
    this.contentElement.classList.toggle('is-editing-style', editing);
    this._isEditingStyle = editing;
  }

  /**
   * @override
   * @param {!Common.Event=} event
   */
  onCSSModelChanged(event) {
    var edit = event && event.data ? /** @type {?SDK.CSSModel.Edit} */ (event.data.edit) : null;
    if (edit) {
      for (var section of this.allSections())
        section._styleSheetEdited(edit);
      return;
    }

    if (this._userOperation || this._isEditingStyle)
      return;

    this._resetCache();
    this.update();
  }

  /**
   * @return {number}
   */
  _focusedSectionIndex() {
    var index = 0;
    for (var block of this._sectionBlocks) {
      for (var section of block.sections) {
        if (section.element.hasFocus())
          return index;
        index++;
      }
    }
    return -1;
  }

  /**
   * @param {?SDK.CSSMatchedStyles} matchedStyles
   */
  _innerRebuildUpdate(matchedStyles) {
    var focusedIndex = this._focusedSectionIndex();

    this._linkifier.reset();
    this._sectionsContainer.removeChildren();
    this._sectionBlocks = [];

    var node = this.node();
    if (!matchedStyles || !node)
      return;

    this._sectionBlocks = this._rebuildSectionsForMatchedStyleRules(matchedStyles);
    var pseudoTypes = [];
    var keys = new Set(matchedStyles.pseudoStyles().keys());
    if (keys.delete(Protocol.DOM.PseudoType.Before))
      pseudoTypes.push(Protocol.DOM.PseudoType.Before);
    pseudoTypes = pseudoTypes.concat(keys.valuesArray().sort());
    for (var pseudoType of pseudoTypes) {
      var block = Elements.SectionBlock.createPseudoTypeBlock(pseudoType);
      var styles =
          /** @type {!Array<!SDK.CSSStyleDeclaration>} */ (matchedStyles.pseudoStyles().get(pseudoType));
      for (var style of styles) {
        var section = new Elements.StylePropertiesSection(this, matchedStyles, style);
        block.sections.push(section);
      }
      this._sectionBlocks.push(block);
    }

    for (var keyframesRule of matchedStyles.keyframes()) {
      var block = Elements.SectionBlock.createKeyframesBlock(keyframesRule.name().text);
      for (var keyframe of keyframesRule.keyframes())
        block.sections.push(new Elements.KeyframePropertiesSection(this, matchedStyles, keyframe.style));
      this._sectionBlocks.push(block);
    }
    var index = 0;
    for (var block of this._sectionBlocks) {
      var titleElement = block.titleElement();
      if (titleElement)
        this._sectionsContainer.appendChild(titleElement);
      for (var section of block.sections) {
        this._sectionsContainer.appendChild(section.element);
        if (index === focusedIndex)
          section.element.focus();
        index++;
      }
    }
    if (focusedIndex >= index)
      this._sectionBlocks[0].sections[0].element.focus();

    this._sectionsContainerFocusChanged();

    if (this._filterRegex)
      this._updateFilter();

    this._nodeStylesUpdatedForTest(node, true);
    if (this._decorator) {
      this._decorator.perform();
      this._decorator = null;
    }
  }

  /**
   * @param {!SDK.DOMNode} node
   * @param {boolean} rebuild
   */
  _nodeStylesUpdatedForTest(node, rebuild) {
    // For sniffing in tests.
  }

  /**
   * @param {!SDK.CSSMatchedStyles} matchedStyles
   * @return {!Array.<!Elements.SectionBlock>}
   */
  _rebuildSectionsForMatchedStyleRules(matchedStyles) {
    var blocks = [new Elements.SectionBlock(null)];
    var lastParentNode = null;
    for (var style of matchedStyles.nodeStyles()) {
      var parentNode = matchedStyles.isInherited(style) ? matchedStyles.nodeForStyle(style) : null;
      if (parentNode && parentNode !== lastParentNode) {
        lastParentNode = parentNode;
        var block = Elements.SectionBlock.createInheritedNodeBlock(lastParentNode);
        blocks.push(block);
      }

      var section = new Elements.StylePropertiesSection(this, matchedStyles, style);
      blocks.peekLast().sections.push(section);
    }
    return blocks;
  }

  async _createNewRuleInViaInspectorStyleSheet() {
    var cssModel = this.cssModel();
    var node = this.node();
    if (!cssModel || !node)
      return;
    this.setUserOperation(true);

    var styleSheetHeader = await cssModel.requestViaInspectorStylesheet(/** @type {!SDK.DOMNode} */ (node));

    this.setUserOperation(false);
    await this._createNewRuleInStyleSheet(styleSheetHeader);
  }

  /**
   * @param {?SDK.CSSStyleSheetHeader} styleSheetHeader
   */
  async _createNewRuleInStyleSheet(styleSheetHeader) {
    if (!styleSheetHeader)
      return;
    var text = await styleSheetHeader.requestContent() || '';
    var lines = text.split('\n');
    var range = TextUtils.TextRange.createFromLocation(lines.length - 1, lines[lines.length - 1].length);
    this._addBlankSection(this._sectionBlocks[0].sections[0], styleSheetHeader.id, range);
  }

  /**
   * @param {!Elements.StylePropertiesSection} insertAfterSection
   * @param {string} styleSheetId
   * @param {!TextUtils.TextRange} ruleLocation
   */
  _addBlankSection(insertAfterSection, styleSheetId, ruleLocation) {
    var node = this.node();
    var blankSection = new Elements.BlankStylePropertiesSection(
        this, insertAfterSection._matchedStyles, node ? Components.DOMPresentationUtils.simpleSelector(node) : '',
        styleSheetId, ruleLocation, insertAfterSection._style);

    this._sectionsContainer.insertBefore(blankSection.element, insertAfterSection.element.nextSibling);

    for (var block of this._sectionBlocks) {
      var index = block.sections.indexOf(insertAfterSection);
      if (index === -1)
        continue;
      block.sections.splice(index + 1, 0, blankSection);
      blankSection.startEditingSelector();
    }
  }

  /**
   * @param {!Elements.StylePropertiesSection} section
   */
  removeSection(section) {
    for (var block of this._sectionBlocks) {
      var index = block.sections.indexOf(section);
      if (index === -1)
        continue;
      block.sections.splice(index, 1);
      section.element.remove();
    }
  }

  /**
   * @return {?RegExp}
   */
  filterRegex() {
    return this._filterRegex;
  }

  _updateFilter() {
    for (var block of this._sectionBlocks)
      block.updateFilter();
  }

  /**
   * @override
   */
  willHide() {
    this._swatchPopoverHelper.hide();
    super.willHide();
  }

  /**
   * @return {!Array<!Elements.StylePropertiesSection>}
   */
  allSections() {
    var sections = [];
    for (var block of this._sectionBlocks)
      sections = sections.concat(block.sections);
    return sections;
  }

  /**
   * @param {!Event} event
   */
  _clipboardCopy(event) {
    Host.userMetrics.actionTaken(Host.UserMetrics.Action.StyleRuleCopied);
  }

  /**
   * @return {!Element}
   */
  _createStylesSidebarToolbar() {
    var container = this.contentElement.createChild('div', 'styles-sidebar-pane-toolbar-container');
    var hbox = container.createChild('div', 'hbox styles-sidebar-pane-toolbar');
    var filterContainerElement = hbox.createChild('div', 'styles-sidebar-pane-filter-box');
    var filterInput = Elements.StylesSidebarPane.createPropertyFilterElement(
        Common.UIString('Filter'), hbox, this._onFilterChanged.bind(this), 'styles-filter-engaged');
    UI.ARIAUtils.setAccessibleName(filterInput, Common.UIString('Filter Styles'));
    filterContainerElement.appendChild(filterInput);
    var toolbar = new UI.Toolbar('styles-pane-toolbar', hbox);
    toolbar.makeToggledGray();
    toolbar.appendLocationItems('styles-sidebarpane-toolbar');
    var toolbarPaneContainer = container.createChild('div', 'styles-sidebar-toolbar-pane-container');
    var toolbarPaneContent = toolbarPaneContainer.createChild('div', 'styles-sidebar-toolbar-pane');

    return toolbarPaneContent;
  }

  /**
   * @param {?UI.Widget} widget
   * @param {?UI.ToolbarToggle} toggle
   */
  showToolbarPane(widget, toggle) {
    if (this._pendingWidgetToggle)
      this._pendingWidgetToggle.setToggled(false);
    this._pendingWidgetToggle = toggle;

    if (this._animatedToolbarPane)
      this._pendingWidget = widget;
    else
      this._startToolbarPaneAnimation(widget);

    if (widget && toggle)
      toggle.setToggled(true);
  }

  /**
   * @param {?UI.Widget} widget
   */
  _startToolbarPaneAnimation(widget) {
    if (widget === this._currentToolbarPane)
      return;

    if (widget && this._currentToolbarPane) {
      this._currentToolbarPane.detach();
      widget.show(this._toolbarPaneElement);
      this._currentToolbarPane = widget;
      this._currentToolbarPane.focus();
      return;
    }

    this._animatedToolbarPane = widget;

    if (this._currentToolbarPane)
      this._toolbarPaneElement.style.animationName = 'styles-element-state-pane-slideout';
    else if (widget)
      this._toolbarPaneElement.style.animationName = 'styles-element-state-pane-slidein';

    if (widget)
      widget.show(this._toolbarPaneElement);

    var listener = onAnimationEnd.bind(this);
    this._toolbarPaneElement.addEventListener('animationend', listener, false);

    /**
     * @this {!Elements.StylesSidebarPane}
     */
    function onAnimationEnd() {
      this._toolbarPaneElement.style.removeProperty('animation-name');
      this._toolbarPaneElement.removeEventListener('animationend', listener, false);

      if (this._currentToolbarPane)
        this._currentToolbarPane.detach();

      this._currentToolbarPane = this._animatedToolbarPane;
      if (this._currentToolbarPane)
        this._currentToolbarPane.focus();
      this._animatedToolbarPane = null;

      if (this._pendingWidget) {
        this._startToolbarPaneAnimation(this._pendingWidget);
        this._pendingWidget = null;
      }
    }
  }
};

Elements.StylesSidebarPane._maxLinkLength = 30;

Elements.SectionBlock = class {
  /**
   * @param {?Element} titleElement
   */
  constructor(titleElement) {
    this._titleElement = titleElement;
    this.sections = [];
  }

  /**
   * @param {!Protocol.DOM.PseudoType} pseudoType
   * @return {!Elements.SectionBlock}
   */
  static createPseudoTypeBlock(pseudoType) {
    var separatorElement = createElement('div');
    separatorElement.className = 'sidebar-separator';
    separatorElement.textContent = Common.UIString('Pseudo ::%s element', pseudoType);
    return new Elements.SectionBlock(separatorElement);
  }

  /**
   * @param {string} keyframesName
   * @return {!Elements.SectionBlock}
   */
  static createKeyframesBlock(keyframesName) {
    var separatorElement = createElement('div');
    separatorElement.className = 'sidebar-separator';
    separatorElement.textContent = Common.UIString('@keyframes ' + keyframesName);
    return new Elements.SectionBlock(separatorElement);
  }

  /**
   * @param {!SDK.DOMNode} node
   * @return {!Elements.SectionBlock}
   */
  static createInheritedNodeBlock(node) {
    var separatorElement = createElement('div');
    separatorElement.className = 'sidebar-separator';
    var link = Components.DOMPresentationUtils.linkifyNodeReference(node);
    separatorElement.createTextChild(Common.UIString('Inherited from') + ' ');
    separatorElement.appendChild(link);
    return new Elements.SectionBlock(separatorElement);
  }

  updateFilter() {
    var hasAnyVisibleSection = false;
    for (var section of this.sections)
      hasAnyVisibleSection |= section._updateFilter();
    if (this._titleElement)
      this._titleElement.classList.toggle('hidden', !hasAnyVisibleSection);
  }

  /**
   * @return {?Element}
   */
  titleElement() {
    return this._titleElement;
  }
};

Elements.StylePropertiesSection = class {
  /**
   * @param {!Elements.StylesSidebarPane} parentPane
   * @param {!SDK.CSSMatchedStyles} matchedStyles
   * @param {!SDK.CSSStyleDeclaration} style
   */
  constructor(parentPane, matchedStyles, style) {
    this._parentPane = parentPane;
    this._style = style;
    this._matchedStyles = matchedStyles;
    this.editable = !!(style.styleSheetId && style.range);
    /** @type {?number} */
    this._hoverTimer = null;
    this._willCauseCancelEditing = false;
    this._forceShowAll = false;
    this._originalPropertiesCount = style.leadingProperties().length;

    var rule = style.parentRule;
    this.element = createElementWithClass('div', 'styles-section matched-styles monospace');
    this.element.tabIndex = -1;
    UI.ARIAUtils.markAsTreeitem(this.element);
    this._editing = false;
    this.element.addEventListener('keydown', this._onKeyDown.bind(this), false);
    this.element._section = this;
    this._innerElement = this.element.createChild('div');

    this._titleElement = this._innerElement.createChild('div', 'styles-section-title ' + (rule ? 'styles-selector' : ''));

    this.propertiesTreeOutline = new UI.TreeOutlineInShadow();
    this.propertiesTreeOutline.setFocusable(false);
    this.propertiesTreeOutline.registerRequiredCSS('elements/stylesSectionTree.css');
    this.propertiesTreeOutline.element.classList.add('style-properties', 'matched-styles', 'monospace');
    this.propertiesTreeOutline.section = this;
    this._innerElement.appendChild(this.propertiesTreeOutline.element);

    this._showAllButton = UI.createTextButton('', this._showAllItems.bind(this), 'styles-show-all');
    this._innerElement.appendChild(this._showAllButton);

    var selectorContainer = createElement('div');
    this._selectorElement = createElementWithClass('span', 'selector');
    this._selectorElement.textContent = this._headerText();
    selectorContainer.appendChild(this._selectorElement);
    this._selectorElement.addEventListener('mouseenter', this._onMouseEnterSelector.bind(this), false);
    this._selectorElement.addEventListener('mouseleave', this._onMouseOutSelector.bind(this), false);

    var openBrace = createElement('span');
    openBrace.textContent = ' {';
    selectorContainer.appendChild(openBrace);
    selectorContainer.addEventListener('mousedown', this._handleEmptySpaceMouseDown.bind(this), false);
    selectorContainer.addEventListener('click', this._handleSelectorContainerClick.bind(this), false);

    var closeBrace = this._innerElement.createChild('div', 'sidebar-pane-closing-brace');
    closeBrace.textContent = '}';

    this._createHoverMenuToolbar(closeBrace);

    this._selectorElement.addEventListener('click', this._handleSelectorClick.bind(this), false);
    this.element.addEventListener('mousedown', this._handleEmptySpaceMouseDown.bind(this), false);
    this.element.addEventListener('click', this._handleEmptySpaceClick.bind(this), false);
    this.element.addEventListener('mousemove', this._onMouseMove.bind(this), false);
    this.element.addEventListener('mouseleave', this._setSectionHovered.bind(this, false), false);

    if (rule) {
      // Prevent editing the user agent and user rules.
      if (rule.isUserAgent() || rule.isInjected()) {
        this.editable = false;
      } else {
        // Check this is a real CSSRule, not a bogus object coming from Elements.BlankStylePropertiesSection.
        if (rule.styleSheetId) {
          var header = rule.cssModel().styleSheetHeaderForId(rule.styleSheetId);
          this.navigable = !header.isAnonymousInlineStyleSheet();
        }
      }
    }

    this._mediaListElement = this._titleElement.createChild('div', 'media-list media-matches');
    this._selectorRefElement = this._titleElement.createChild('div', 'styles-section-subtitle');
    this._updateMediaList();
    this._updateRuleOrigin();
    this._titleElement.appendChild(selectorContainer);
    this._selectorContainer = selectorContainer;

    if (this.navigable)
      this.element.classList.add('navigable');

    if (!this.editable) {
      this.element.classList.add('read-only');
      this.propertiesTreeOutline.element.classList.add('read-only');
    }

    var throttler = new Common.Throttler(100);
    this._scheduleHeightUpdate = () => throttler.schedule(this._manuallySetHeight.bind(this));

    this._hoverableSelectorsMode = false;
    this._markSelectorMatches();
    this.onpopulate();
  }

  /**
   * @param {!SDK.CSSMatchedStyles} matchedStyles
   * @param {!Components.Linkifier} linkifier
   * @param {?SDK.CSSRule} rule
   * @return {!Node}
   */
  static createRuleOriginNode(matchedStyles, linkifier, rule) {
    if (!rule)
      return createTextNode('');

    var ruleLocation;
    if (rule instanceof SDK.CSSStyleRule)
      ruleLocation = rule.style.range;
    else if (rule instanceof SDK.CSSKeyframeRule)
      ruleLocation = rule.key().range;

    var header = rule.styleSheetId ? matchedStyles.cssModel().styleSheetHeaderForId(rule.styleSheetId) : null;
    if (ruleLocation && rule.styleSheetId && header && !header.isAnonymousInlineStyleSheet()) {
      return Elements.StylePropertiesSection._linkifyRuleLocation(
          matchedStyles.cssModel(), linkifier, rule.styleSheetId, ruleLocation);
    }

    if (rule.isUserAgent())
      return createTextNode(Common.UIString('user agent stylesheet'));
    if (rule.isInjected())
      return createTextNode(Common.UIString('injected stylesheet'));
    if (rule.isViaInspector())
      return createTextNode(Common.UIString('via inspector'));

    if (header && header.ownerNode) {
      var link = Components.DOMPresentationUtils.linkifyDeferredNodeReference(header.ownerNode);
      link.textContent = '<style>…</style>';
      return link;
    }

    return createTextNode('');
  }

  /**
   * @param {!SDK.CSSModel} cssModel
   * @param {!Components.Linkifier} linkifier
   * @param {string} styleSheetId
   * @param {!TextUtils.TextRange} ruleLocation
   * @return {!Node}
   */
  static _linkifyRuleLocation(cssModel, linkifier, styleSheetId, ruleLocation) {
    var styleSheetHeader = cssModel.styleSheetHeaderForId(styleSheetId);
    var lineNumber = styleSheetHeader.lineNumberInSource(ruleLocation.startLine);
    var columnNumber = styleSheetHeader.columnNumberInSource(ruleLocation.startLine, ruleLocation.startColumn);
    var matchingSelectorLocation = new SDK.CSSLocation(styleSheetHeader, lineNumber, columnNumber);
    return linkifier.linkifyCSSLocation(matchingSelectorLocation);
  }

  /**
   * @param {!Event} event
   */
  _onKeyDown(event) {
    if (this._editing || !this.editable || event.altKey || event.ctrlKey || event.metaKey)
      return;
    switch (event.key) {
      case 'Enter':
      case ' ':
        this._startEditingAtFirstPosition();
        event.consume(true);
        break;
      default:
        // Filter out non-printable key strokes.
        if (event.key.length === 1)
          this.addNewBlankProperty(0).startEditing();
        break;
    }
  }

  /**
   * @param {boolean} isHovered
   */
  _setSectionHovered(isHovered) {
    this.element.classList.toggle('styles-panel-hovered', isHovered);
    this.propertiesTreeOutline.element.classList.toggle('styles-panel-hovered', isHovered);
    if (this._hoverableSelectorsMode !== isHovered) {
      this._hoverableSelectorsMode = isHovered;
      this._markSelectorMatches();
    }
  }

  /**
   * @param {!Event} event
   */
  _onMouseMove(event) {
    var hasCtrlOrMeta = UI.KeyboardShortcut.eventHasCtrlOrMeta(/** @type {!MouseEvent} */ (event));
    this._setSectionHovered(hasCtrlOrMeta);
  }

  /**
   * @param {!Element} container
   */
  _createHoverMenuToolbar(container) {
    if (!this.editable)
      return;
    var items = [];

    var textShadowButton = new UI.ToolbarButton(Common.UIString('Add text-shadow'), 'largeicon-text-shadow');
    textShadowButton.addEventListener(
        UI.ToolbarButton.Events.Click, this._onInsertShadowPropertyClick.bind(this, 'text-shadow'));
    textShadowButton.element.tabIndex = -1;
    items.push(textShadowButton);

    var boxShadowButton = new UI.ToolbarButton(Common.UIString('Add box-shadow'), 'largeicon-box-shadow');
    boxShadowButton.addEventListener(
        UI.ToolbarButton.Events.Click, this._onInsertShadowPropertyClick.bind(this, 'box-shadow'));
    boxShadowButton.element.tabIndex = -1;
    items.push(boxShadowButton);

    var colorButton = new UI.ToolbarButton(Common.UIString('Add color'), 'largeicon-foreground-color');
    colorButton.addEventListener(UI.ToolbarButton.Events.Click, this._onInsertColorPropertyClick, this);
    colorButton.element.tabIndex = -1;
    items.push(colorButton);

    var backgroundButton = new UI.ToolbarButton(Common.UIString('Add background-color'), 'largeicon-background-color');
    backgroundButton.addEventListener(UI.ToolbarButton.Events.Click, this._onInsertBackgroundColorPropertyClick, this);
    backgroundButton.element.tabIndex = -1;
    items.push(backgroundButton);

    var newRuleButton = null;
    if (this._style.parentRule) {
      newRuleButton = new UI.ToolbarButton(Common.UIString('Insert Style Rule Below'), 'largeicon-add');
      newRuleButton.addEventListener(UI.ToolbarButton.Events.Click, this._onNewRuleClick, this);
      newRuleButton.element.tabIndex = -1;
      items.push(newRuleButton);
    }

    var sectionToolbar = new UI.Toolbar('sidebar-pane-section-toolbar', container);
    for (var i = 0; i < items.length; ++i)
      sectionToolbar.appendToolbarItem(items[i]);

    var menuButton = new UI.ToolbarButton(Common.UIString('More tools\u2026'), 'largeicon-menu');
    menuButton.element.tabIndex = -1;
    sectionToolbar.appendToolbarItem(menuButton);
    setItemsVisibility.call(this, items, false);
    sectionToolbar.element.addEventListener('mouseenter', setItemsVisibility.bind(this, items, true));
    sectionToolbar.element.addEventListener('mouseleave', setItemsVisibility.bind(this, items, false));
    UI.ARIAUtils.markAsHidden(sectionToolbar.element);

    /**
     * @param {!Array<!UI.ToolbarButton>} items
     * @param {boolean} value
     * @this {Elements.StylePropertiesSection}
     */
    function setItemsVisibility(items, value) {
      for (var i = 0; i < items.length; ++i)
        items[i].setVisible(value);
      menuButton.setVisible(!value);
      if (this._isSASSStyle())
        newRuleButton.setVisible(false);
    }
  }

  /**
   * @return {boolean}
   */
  _isSASSStyle() {
    var header =
        this._style.styleSheetId ? this._style.cssModel().styleSheetHeaderForId(this._style.styleSheetId) : null;
    if (!header)
      return false;
    var sourceMap = header.cssModel().sourceMapManager().sourceMapForClient(header);
    return sourceMap ? sourceMap.editable() : false;
  }

  /**
   * @return {!SDK.CSSStyleDeclaration}
   */
  style() {
    return this._style;
  }

  /**
   * @return {string}
   */
  _headerText() {
    var node = this._matchedStyles.nodeForStyle(this._style);
    if (this._style.type === SDK.CSSStyleDeclaration.Type.Inline)
      return this._matchedStyles.isInherited(this._style) ? Common.UIString('Style Attribute') : 'element.style';
    if (this._style.type === SDK.CSSStyleDeclaration.Type.Attributes)
      return node.nodeNameInCorrectCase() + '[' + Common.UIString('Attributes Style') + ']';
    return this._style.parentRule.selectorText();
  }

  _onMouseOutSelector() {
    if (this._hoverTimer)
      clearTimeout(this._hoverTimer);
    SDK.OverlayModel.hideDOMNodeHighlight();
  }

  _onMouseEnterSelector() {
    if (this._hoverTimer)
      clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(this._highlight.bind(this), 300);
  }

  _highlight() {
    SDK.OverlayModel.hideDOMNodeHighlight();
    var node = this._parentPane.node();
    var selectors = this._style.parentRule ? this._style.parentRule.selectorText() : undefined;
    node.domModel().overlayModel().highlightDOMNodeWithConfig(
        node.id, {mode: 'all', showInfo: undefined, selectors: selectors});
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  firstSibling() {
    var parent = this.element.parentElement;
    if (!parent)
      return null;

    var childElement = parent.firstChild;
    while (childElement) {
      if (childElement._section)
        return childElement._section;
      childElement = childElement.nextSibling;
    }

    return null;
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  lastSibling() {
    var parent = this.element.parentElement;
    if (!parent)
      return null;

    var childElement = parent.lastChild;
    while (childElement) {
      if (childElement._section)
        return childElement._section;
      childElement = childElement.previousSibling;
    }

    return null;
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  nextSibling() {
    var curElement = this.element;
    do
      curElement = curElement.nextSibling;
    while (curElement && !curElement._section);

    return curElement ? curElement._section : null;
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  previousSibling() {
    var curElement = this.element;
    do
      curElement = curElement.previousSibling;
    while (curElement && !curElement._section);

    return curElement ? curElement._section : null;
  }

  /**
   * @param {!Common.Event} event
   */
  _onNewRuleClick(event) {
    event.data.consume();
    var rule = this._style.parentRule;
    var range = TextUtils.TextRange.createFromLocation(rule.style.range.endLine, rule.style.range.endColumn + 1);
    this._parentPane._addBlankSection(this, /** @type {string} */ (rule.styleSheetId), range);
  }

  /**
   * @param {string} propertyName
   * @param {!Common.Event} event
   */
  _onInsertShadowPropertyClick(propertyName, event) {
    event.data.consume(true);
    var treeElement = this.addNewBlankProperty();
    treeElement.property.name = propertyName;
    treeElement.property.value = '0 0 black';
    treeElement.updateTitle();
    var shadowSwatchPopoverHelper = Elements.ShadowSwatchPopoverHelper.forTreeElement(treeElement);
    if (shadowSwatchPopoverHelper)
      shadowSwatchPopoverHelper.showPopover();
  }

  /**
   * @param {!Common.Event} event
   */
  _onInsertColorPropertyClick(event) {
    event.data.consume(true);
    var treeElement = this.addNewBlankProperty();
    treeElement.property.name = 'color';
    treeElement.property.value = 'black';
    treeElement.updateTitle();
    var colorSwatch = Elements.ColorSwatchPopoverIcon.forTreeElement(treeElement);
    if (colorSwatch)
      colorSwatch.showPopover();
  }

  /**
   * @param {!Common.Event} event
   */
  _onInsertBackgroundColorPropertyClick(event) {
    event.data.consume(true);
    var treeElement = this.addNewBlankProperty();
    treeElement.property.name = 'background-color';
    treeElement.property.value = 'white';
    treeElement.updateTitle();
    var colorSwatch = Elements.ColorSwatchPopoverIcon.forTreeElement(treeElement);
    if (colorSwatch)
      colorSwatch.showPopover();
  }

  /**
   * @param {!SDK.CSSModel.Edit} edit
   */
  _styleSheetEdited(edit) {
    var rule = this._style.parentRule;
    if (rule)
      rule.rebase(edit);
    else
      this._style.rebase(edit);

    this._updateMediaList();
    this._updateRuleOrigin();
  }

  /**
   * @param {!Array.<!SDK.CSSMedia>} mediaRules
   */
  _createMediaList(mediaRules) {
    for (var i = mediaRules.length - 1; i >= 0; --i) {
      var media = mediaRules[i];
      // Don't display trivial non-print media types.
      if (!media.text.includes('(') && media.text !== 'print')
        continue;
      var mediaDataElement = this._mediaListElement.createChild('div', 'media');
      var mediaContainerElement = mediaDataElement.createChild('span');
      var mediaTextElement = mediaContainerElement.createChild('span', 'media-text');
      switch (media.source) {
        case SDK.CSSMedia.Source.LINKED_SHEET:
        case SDK.CSSMedia.Source.INLINE_SHEET:
          mediaTextElement.textContent = 'media="' + media.text + '"';
          break;
        case SDK.CSSMedia.Source.MEDIA_RULE:
          var decoration = mediaContainerElement.createChild('span');
          mediaContainerElement.insertBefore(decoration, mediaTextElement);
          decoration.textContent = '@media ';
          mediaTextElement.textContent = media.text;
          if (media.styleSheetId) {
            mediaDataElement.classList.add('editable-media');
            mediaTextElement.addEventListener(
                'click', this._handleMediaRuleClick.bind(this, media, mediaTextElement), false);
          }
          break;
        case SDK.CSSMedia.Source.IMPORT_RULE:
          mediaTextElement.textContent = '@import ' + media.text;
          break;
      }
    }
  }

  _updateMediaList() {
    this._mediaListElement.removeChildren();
    if (this._style.parentRule && this._style.parentRule instanceof SDK.CSSStyleRule)
      this._createMediaList(this._style.parentRule.media);
  }

  /**
   * @param {string} propertyName
   * @return {boolean}
   */
  isPropertyInherited(propertyName) {
    if (this._matchedStyles.isInherited(this._style)) {
      // While rendering inherited stylesheet, reverse meaning of this property.
      // Render truly inherited properties with black, i.e. return them as non-inherited.
      return !SDK.cssMetadata().isPropertyInherited(propertyName);
    }
    return false;
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  nextEditableSibling() {
    var curSection = this;
    do
      curSection = curSection.nextSibling();
    while (curSection && !curSection.editable);

    if (!curSection) {
      curSection = this.firstSibling();
      while (curSection && !curSection.editable)
        curSection = curSection.nextSibling();
    }

    return (curSection && curSection.editable) ? curSection : null;
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  previousEditableSibling() {
    var curSection = this;
    do
      curSection = curSection.previousSibling();
    while (curSection && !curSection.editable);

    if (!curSection) {
      curSection = this.lastSibling();
      while (curSection && !curSection.editable)
        curSection = curSection.previousSibling();
    }

    return (curSection && curSection.editable) ? curSection : null;
  }

  refreshUpdate() {
    this._parentPane._refreshUpdate(this);
  }

  /**
   * @param {boolean} full
   */
  update(full) {
    this._selectorElement.textContent = this._headerText();
    this._markSelectorMatches();
    if (full) {
      this.onpopulate();
    } else {
      var child = this.propertiesTreeOutline.firstChild();
      while (child) {
        child.setOverloaded(this._isPropertyOverloaded(child.property));
        child = child.traverseNextTreeElement(false, null, true);
      }
    }
  }

  /**
   * @param {!Event=} event
   */
  _showAllItems(event) {
    if (event)
      event.consume();
    if (this._forceShowAll)
      return;
    this._forceShowAll = true;
    this.onpopulate();
  }

  onpopulate() {
    this.propertiesTreeOutline.removeChildren();
    var style = this._style;
    var count = 0;
    var properties = style.leadingProperties();
    var maxProperties =
        Elements.StylePropertiesSection.MaxProperties + properties.length - this._originalPropertiesCount;

    for (var property of properties) {
      if (!this._forceShowAll && count >= maxProperties)
        break;
      count++;
      var isShorthand = !!style.longhandProperties(property.name).length;
      var inherited = this.isPropertyInherited(property.name);
      var overloaded = this._isPropertyOverloaded(property);
      var item = new Elements.StylePropertyTreeElement(
          this._parentPane, this._matchedStyles, property, isShorthand, inherited, overloaded, false);
      this.propertiesTreeOutline.appendChild(item);
    }

    if (count < properties.length) {
      this._showAllButton.classList.remove('hidden');
      this._showAllButton.textContent = ls`Show All Properties (${properties.length - count} more)`;
    } else {
      this._showAllButton.classList.add('hidden');
    }
  }

  /**
   * @param {!SDK.CSSProperty} property
   * @return {boolean}
   */
  _isPropertyOverloaded(property) {
    return this._matchedStyles.propertyState(property) === SDK.CSSMatchedStyles.PropertyState.Overloaded;
  }

  /**
   * @return {boolean}
   */
  _updateFilter() {
    var hasMatchingChild = false;
    this._showAllItems();
    for (var child of this.propertiesTreeOutline.rootElement().children())
      hasMatchingChild |= child._updateFilter();

    var regex = this._parentPane.filterRegex();
    var hideRule = !hasMatchingChild && !!regex && !regex.test(this.element.deepTextContent());
    this.element.classList.toggle('hidden', hideRule);
    if (!hideRule && this._style.parentRule)
      this._markSelectorHighlights();
    return !hideRule;
  }

  _markSelectorMatches() {
    var rule = this._style.parentRule;
    if (!rule)
      return;

    this._mediaListElement.classList.toggle('media-matches', this._matchedStyles.mediaMatches(this._style));

    var selectorTexts = rule.selectors.map(selector => selector.text);
    var matchingSelectorIndexes = this._matchedStyles.matchingSelectors(/** @type {!SDK.CSSStyleRule} */ (rule));
    var matchingSelectors = /** @type {!Array<boolean>} */ (new Array(selectorTexts.length).fill(false));
    for (var matchingIndex of matchingSelectorIndexes)
      matchingSelectors[matchingIndex] = true;

    if (this._parentPane._isEditingStyle)
      return;

    var fragment = this._hoverableSelectorsMode ? this._renderHoverableSelectors(selectorTexts, matchingSelectors) :
                                                  this._renderSimplifiedSelectors(selectorTexts, matchingSelectors);
    this._selectorElement.removeChildren();
    this._selectorElement.appendChild(fragment);
    this._markSelectorHighlights();
  }

  /**
   * @param {!Array<string>} selectors
   * @param {!Array<boolean>} matchingSelectors
   * @return {!DocumentFragment}
   */
  _renderHoverableSelectors(selectors, matchingSelectors) {
    var fragment = createDocumentFragment();
    for (var i = 0; i < selectors.length; ++i) {
      if (i)
        fragment.createTextChild(', ');
      fragment.appendChild(this._createSelectorElement(selectors[i], matchingSelectors[i], i));
    }
    return fragment;
  }

  /**
   * @param {string} text
   * @param {boolean} isMatching
   * @param {number=} navigationIndex
   * @return {!Element}
   */
  _createSelectorElement(text, isMatching, navigationIndex) {
    var element = createElementWithClass('span', 'simple-selector');
    element.classList.toggle('selector-matches', isMatching);
    if (typeof navigationIndex === 'number')
      element._selectorIndex = navigationIndex;
    element.textContent = text;
    return element;
  }

  /**
   * @param {!Array<string>} selectors
   * @param {!Array<boolean>} matchingSelectors
   * @return {!DocumentFragment}
   */
  _renderSimplifiedSelectors(selectors, matchingSelectors) {
    var fragment = createDocumentFragment();
    var currentMatching = false;
    var text = '';
    for (var i = 0; i < selectors.length; ++i) {
      if (currentMatching !== matchingSelectors[i] && text) {
        fragment.appendChild(this._createSelectorElement(text, currentMatching));
        text = '';
      }
      currentMatching = matchingSelectors[i];
      text += selectors[i] + (i === selectors.length - 1 ? '' : ', ');
    }
    if (text)
      fragment.appendChild(this._createSelectorElement(text, currentMatching));
    return fragment;
  }

  _markSelectorHighlights() {
    var selectors = this._selectorElement.getElementsByClassName('simple-selector');
    var regex = this._parentPane.filterRegex();
    for (var i = 0; i < selectors.length; ++i) {
      var selectorMatchesFilter = !!regex && regex.test(selectors[i].textContent);
      selectors[i].classList.toggle('filter-match', selectorMatchesFilter);
    }
  }

  /**
   * @return {boolean}
   */
  _checkWillCancelEditing() {
    var willCauseCancelEditing = this._willCauseCancelEditing;
    this._willCauseCancelEditing = false;
    return willCauseCancelEditing;
  }

  /**
   * @param {!Event} event
   */
  _handleSelectorContainerClick(event) {
    if (this._checkWillCancelEditing() || !this.editable)
      return;
    if (event.target === this._selectorContainer) {
      this.addNewBlankProperty(0).startEditing();
      event.consume(true);
    }
  }

  /**
   * @param {number=} index
   * @return {!Elements.StylePropertyTreeElement}
   */
  addNewBlankProperty(index = this.propertiesTreeOutline.rootElement().childCount()) {
    var property = this._style.newBlankProperty(index);
    var item = new Elements.StylePropertyTreeElement(
        this._parentPane, this._matchedStyles, property, false, false, false, true);
    this.propertiesTreeOutline.insertChild(item, property.index);
    return item;
  }

  _handleEmptySpaceMouseDown() {
    this._willCauseCancelEditing = this._parentPane._isEditingStyle;
  }

  /**
   * @param {!Event} event
   */
  _handleEmptySpaceClick(event) {
    if (!this.editable || this.element.hasSelection() || this._checkWillCancelEditing())
      return;

    if (event.target.classList.contains('header') || this.element.classList.contains('read-only') ||
        event.target.enclosingNodeOrSelfWithClass('media')) {
      event.consume();
      return;
    }
    var deepTarget = event.deepElementFromPoint();
    if (deepTarget.treeElement)
      this.addNewBlankProperty(deepTarget.treeElement.property.index + 1).startEditing();
    else
      this.addNewBlankProperty().startEditing();
    event.consume(true);
  }

  /**
   * @param {!SDK.CSSMedia} media
   * @param {!Element} element
   * @param {!Event} event
   */
  _handleMediaRuleClick(media, element, event) {
    if (UI.isBeingEdited(element))
      return;

    if (UI.KeyboardShortcut.eventHasCtrlOrMeta(/** @type {!MouseEvent} */ (event)) && this.navigable) {
      var location = media.rawLocation();
      if (!location) {
        event.consume(true);
        return;
      }
      var uiLocation = Bindings.cssWorkspaceBinding.rawLocationToUILocation(location);
      if (uiLocation)
        Common.Revealer.reveal(uiLocation);
      event.consume(true);
      return;
    }

    if (!this.editable || this._isSASSStyle())
      return;

    var config = new UI.InplaceEditor.Config(
        this._editingMediaCommitted.bind(this, media), this._editingMediaCancelled.bind(this, element), undefined,
        this._editingMediaBlurHandler.bind(this));
    UI.InplaceEditor.startEditing(element, config);
    this.startEditing();

    element.getComponentSelection().selectAllChildren(element);
    this._parentPane.setEditingStyle(true);
    var parentMediaElement = element.enclosingNodeOrSelfWithClass('media');
    parentMediaElement.classList.add('editing-media');

    event.consume(true);
  }

  /**
   * @param {!Element} element
   */
  _editingMediaFinished(element) {
    this._parentPane.setEditingStyle(false);
    var parentMediaElement = element.enclosingNodeOrSelfWithClass('media');
    parentMediaElement.classList.remove('editing-media');
    this.stopEditing();
  }

  /**
   * @param {!Element} element
   */
  _editingMediaCancelled(element) {
    this._editingMediaFinished(element);
    // Mark the selectors in group if necessary.
    // This is overridden by BlankStylePropertiesSection.
    this._markSelectorMatches();
    element.getComponentSelection().collapse(element, 0);
  }

  /**
   * @param {!Element} editor
   * @param {!Event} blurEvent
   * @return {boolean}
   */
  _editingMediaBlurHandler(editor, blurEvent) {
    return true;
  }

  /**
   * @param {!SDK.CSSMedia} media
   * @param {!Element} element
   * @param {string} newContent
   * @param {string} oldContent
   * @param {(!Elements.StylePropertyTreeElement.Context|undefined)} context
   * @param {string} moveDirection
   */
  _editingMediaCommitted(media, element, newContent, oldContent, context, moveDirection) {
    this._parentPane.setEditingStyle(false);
    this._editingMediaFinished(element);

    if (newContent)
      newContent = newContent.trim();

    /**
     * @param {boolean} success
     * @this {Elements.StylePropertiesSection}
     */
    function userCallback(success) {
      if (success) {
        this._matchedStyles.resetActiveProperties();
        this._parentPane._refreshUpdate(this);
      }
      this._parentPane.setUserOperation(false);
      this._editingMediaTextCommittedForTest();
    }

    // This gets deleted in finishOperation(), which is called both on success and failure.
    this._parentPane.setUserOperation(true);
    this._parentPane.cssModel().setMediaText(media.styleSheetId, media.range, newContent).then(userCallback.bind(this));
  }

  _editingMediaTextCommittedForTest() {
  }

  /**
   * @param {!Event} event
   */
  _handleSelectorClick(event) {
    if (UI.KeyboardShortcut.eventHasCtrlOrMeta(/** @type {!MouseEvent} */ (event)) && this.navigable &&
        event.target.classList.contains('simple-selector')) {
      this._navigateToSelectorSource(event.target._selectorIndex, true);
      event.consume(true);
      return;
    }
    this._startEditingAtFirstPosition();
    event.consume(true);
  }

  /**
   * @param {number} index
   * @param {boolean} focus
   */
  _navigateToSelectorSource(index, focus) {
    var cssModel = this._parentPane.cssModel();
    var rule = this._style.parentRule;
    var header = cssModel.styleSheetHeaderForId(/** @type {string} */ (rule.styleSheetId));
    if (!header)
      return;
    var rawLocation = new SDK.CSSLocation(header, rule.lineNumberInSource(index), rule.columnNumberInSource(index));
    var uiLocation = Bindings.cssWorkspaceBinding.rawLocationToUILocation(rawLocation);
    if (uiLocation)
      Common.Revealer.reveal(uiLocation, !focus);
  }

  _startEditingAtFirstPosition() {
    if (!this.editable || this._isSASSStyle())
      return;

    if (!this._style.parentRule) {
      this.moveEditorFromSelector('forward');
      return;
    }

    this.startEditingSelector();
  }

  startEditingSelector() {
    var element = this._selectorElement;
    if (UI.isBeingEdited(element))
      return;

    element.scrollIntoViewIfNeeded(false);
    // Reset selector marks in group, and normalize whitespace.
    element.textContent = element.textContent.replace(/\s+/g, ' ').trim();

    var config =
        new UI.InplaceEditor.Config(this.editingSelectorCommitted.bind(this), this.editingSelectorCancelled.bind(this));
    UI.InplaceEditor.startEditing(this._selectorElement, config);
    this.startEditing();

    element.getComponentSelection().selectAllChildren(element);
    this._parentPane.setEditingStyle(true);
    if (element.classList.contains('simple-selector'))
      this._navigateToSelectorSource(0, false);
  }

  /**
   * @param {string} moveDirection
   */
  moveEditorFromSelector(moveDirection) {
    this._markSelectorMatches();

    if (!moveDirection)
      return;

    if (moveDirection === 'forward') {
      var firstChild = this.propertiesTreeOutline.firstChild();
      while (firstChild && firstChild.inherited())
        firstChild = firstChild.nextSibling;
      if (!firstChild)
        this.addNewBlankProperty().startEditing();
      else
        firstChild.startEditing(firstChild.nameElement);
    } else {
      var previousSection = this.previousEditableSibling();
      if (!previousSection)
        return;

      previousSection.addNewBlankProperty().startEditing();
    }
  }

  /**
   * @param {!Element} element
   * @param {string} newContent
   * @param {string} oldContent
   * @param {(!Elements.StylePropertyTreeElement.Context|undefined)} context
   * @param {string} moveDirection
   */
  editingSelectorCommitted(element, newContent, oldContent, context, moveDirection) {
    this._editingSelectorEnded();
    if (newContent)
      newContent = newContent.trim();
    if (newContent === oldContent) {
      // Revert to a trimmed version of the selector if need be.
      this._selectorElement.textContent = newContent;
      this.moveEditorFromSelector(moveDirection);
      return;
    }
    var rule = this._style.parentRule;
    if (!rule)
      return;

    /**
     * @this {Elements.StylePropertiesSection}
     */
    function headerTextCommitted() {
      this._parentPane.setUserOperation(false);
      this.moveEditorFromSelector(moveDirection);
      this._editingSelectorCommittedForTest();
    }

    // This gets deleted in finishOperationAndMoveEditor(), which is called both on success and failure.
    this._parentPane.setUserOperation(true);
    this._setHeaderText(rule, newContent).then(headerTextCommitted.bind(this));
  }

  /**
   * @param {!SDK.CSSRule} rule
   * @param {string} newContent
   * @return {!Promise}
   */
  _setHeaderText(rule, newContent) {
    /**
     * @param {!SDK.CSSStyleRule} rule
     * @param {boolean} success
     * @return {!Promise}
     * @this {Elements.StylePropertiesSection}
     */
    function onSelectorsUpdated(rule, success) {
      if (!success)
        return Promise.resolve();
      return this._matchedStyles.recomputeMatchingSelectors(rule).then(updateSourceRanges.bind(this, rule));
    }

    /**
     * @param {!SDK.CSSStyleRule} rule
     * @this {Elements.StylePropertiesSection}
     */
    function updateSourceRanges(rule) {
      var doesAffectSelectedNode = this._matchedStyles.matchingSelectors(rule).length > 0;
      this.propertiesTreeOutline.element.classList.toggle('no-affect', !doesAffectSelectedNode);
      this._matchedStyles.resetActiveProperties();
      this._parentPane._refreshUpdate(this);
    }

    console.assert(rule instanceof SDK.CSSStyleRule);
    var oldSelectorRange = rule.selectorRange();
    if (!oldSelectorRange)
      return Promise.resolve();
    return rule.setSelectorText(newContent)
        .then(onSelectorsUpdated.bind(this, /** @type {!SDK.CSSStyleRule} */ (rule), oldSelectorRange));
  }

  _editingSelectorCommittedForTest() {
  }

  _updateRuleOrigin() {
    this._selectorRefElement.removeChildren();
    this._selectorRefElement.appendChild(Elements.StylePropertiesSection.createRuleOriginNode(
        this._matchedStyles, this._parentPane._linkifier, this._style.parentRule));
  }

  _editingSelectorEnded() {
    this._parentPane.setEditingStyle(false);
    this.stopEditing();
  }

  editingSelectorCancelled() {
    this._editingSelectorEnded();

    // Mark the selectors in group if necessary.
    // This is overridden by BlankStylePropertiesSection.
    this._markSelectorMatches();
  }

  startEditing() {
    this._manuallySetHeight();
    this.element.addEventListener('input', this._scheduleHeightUpdate, true);
    this._editing = true;
  }

  /**
   * @return {!Promise}
   */
  _manuallySetHeight() {
    this.element.style.height = (this._innerElement.clientHeight + 1) + 'px';
    this.element.style.contain = 'strict';
    return Promise.resolve();
  }

  stopEditing() {
    this.element.style.removeProperty('height');
    this.element.style.removeProperty('contain');
    this.element.removeEventListener('input', this._scheduleHeightUpdate, true);
    this._editing = false;
    if (this._parentPane.element === this._parentPane.element.ownerDocument.deepActiveElement())
      this.element.focus();
  }
};

Elements.BlankStylePropertiesSection = class extends Elements.StylePropertiesSection {
  /**
   * @param {!Elements.StylesSidebarPane} stylesPane
   * @param {!SDK.CSSMatchedStyles} matchedStyles
   * @param {string} defaultSelectorText
   * @param {string} styleSheetId
   * @param {!TextUtils.TextRange} ruleLocation
   * @param {!SDK.CSSStyleDeclaration} insertAfterStyle
   */
  constructor(stylesPane, matchedStyles, defaultSelectorText, styleSheetId, ruleLocation, insertAfterStyle) {
    var cssModel = /** @type {!SDK.CSSModel} */ (stylesPane.cssModel());
    var rule = SDK.CSSStyleRule.createDummyRule(cssModel, defaultSelectorText);
    super(stylesPane, matchedStyles, rule.style);
    this._normal = false;
    this._ruleLocation = ruleLocation;
    this._styleSheetId = styleSheetId;
    this._selectorRefElement.removeChildren();
    this._selectorRefElement.appendChild(Elements.StylePropertiesSection._linkifyRuleLocation(
        cssModel, this._parentPane._linkifier, styleSheetId, this._actualRuleLocation()));
    if (insertAfterStyle && insertAfterStyle.parentRule)
      this._createMediaList(insertAfterStyle.parentRule.media);
    this.element.classList.add('blank-section');
  }

  /**
   * @return {!TextUtils.TextRange}
   */
  _actualRuleLocation() {
    var prefix = this._rulePrefix();
    var lines = prefix.split('\n');
    var editRange = new TextUtils.TextRange(0, 0, lines.length - 1, lines.peekLast().length);
    return this._ruleLocation.rebaseAfterTextEdit(TextUtils.TextRange.createFromLocation(0, 0), editRange);
  }

  /**
   * @return {string}
   */
  _rulePrefix() {
    return this._ruleLocation.startLine === 0 && this._ruleLocation.startColumn === 0 ? '' : '\n\n';
  }

  /**
   * @return {boolean}
   */
  get isBlank() {
    return !this._normal;
  }

  /**
   * @override
   * @param {!Element} element
   * @param {string} newContent
   * @param {string} oldContent
   * @param {!Elements.StylePropertyTreeElement.Context|undefined} context
   * @param {string} moveDirection
   */
  editingSelectorCommitted(element, newContent, oldContent, context, moveDirection) {
    if (!this.isBlank) {
      super.editingSelectorCommitted(element, newContent, oldContent, context, moveDirection);
      return;
    }

    /**
     * @param {?SDK.CSSStyleRule} newRule
     * @return {!Promise}
     * @this {Elements.BlankStylePropertiesSection}
     */
    function onRuleAdded(newRule) {
      if (!newRule) {
        this.editingSelectorCancelled();
        this._editingSelectorCommittedForTest();
        return Promise.resolve();
      }
      return this._matchedStyles.addNewRule(newRule, this._matchedStyles.node())
          .then(onAddedToCascade.bind(this, newRule));
    }

    /**
     * @param {!SDK.CSSStyleRule} newRule
     * @this {Elements.BlankStylePropertiesSection}
     */
    function onAddedToCascade(newRule) {
      var doesSelectorAffectSelectedNode = this._matchedStyles.matchingSelectors(newRule).length > 0;
      this._makeNormal(newRule);

      if (!doesSelectorAffectSelectedNode)
        this.propertiesTreeOutline.element.classList.add('no-affect');

      this._updateRuleOrigin();

      this._parentPane.setUserOperation(false);
      this._editingSelectorEnded();
      if (this.element.parentElement)  // Might have been detached already.
        this.moveEditorFromSelector(moveDirection);
      this._markSelectorMatches();

      this._editingSelectorCommittedForTest();
    }

    if (newContent)
      newContent = newContent.trim();
    this._parentPane.setUserOperation(true);

    var cssModel = this._parentPane.cssModel();
    var ruleText = this._rulePrefix() + newContent + ' {}';
    cssModel.addRule(this._styleSheetId, ruleText, this._ruleLocation).then(onRuleAdded.bind(this));
  }

  /**
   * @override
   */
  editingSelectorCancelled() {
    this._parentPane.setUserOperation(false);
    if (!this.isBlank) {
      super.editingSelectorCancelled();
      return;
    }

    this._editingSelectorEnded();
    this._parentPane.removeSection(this);
  }

  /**
   * @param {!SDK.CSSRule} newRule
   */
  _makeNormal(newRule) {
    this.element.classList.remove('blank-section');
    this._style = newRule.style;
    // FIXME: replace this instance by a normal Elements.StylePropertiesSection.
    this._normal = true;
  }
};
Elements.StylePropertiesSection.MaxProperties = 50;

Elements.KeyframePropertiesSection = class extends Elements.StylePropertiesSection {
  /**
   * @param {!Elements.StylesSidebarPane} stylesPane
   * @param {!SDK.CSSMatchedStyles} matchedStyles
   * @param {!SDK.CSSStyleDeclaration} style
   */
  constructor(stylesPane, matchedStyles, style) {
    super(stylesPane, matchedStyles, style);
    this._selectorElement.className = 'keyframe-key';
  }

  /**
   * @override
   * @return {string}
   */
  _headerText() {
    return this._style.parentRule.key().text;
  }

  /**
   * @override
   * @param {!SDK.CSSRule} rule
   * @param {string} newContent
   * @return {!Promise}
   */
  _setHeaderText(rule, newContent) {
    /**
     * @param {boolean} success
     * @this {Elements.KeyframePropertiesSection}
     */
    function updateSourceRanges(success) {
      if (!success)
        return;
      this._parentPane._refreshUpdate(this);
    }

    console.assert(rule instanceof SDK.CSSKeyframeRule);
    var oldRange = rule.key().range;
    if (!oldRange)
      return Promise.resolve();
    return rule.setKeyText(newContent).then(updateSourceRanges.bind(this));
  }

  /**
   * @override
   * @param {string} propertyName
   * @return {boolean}
   */
  isPropertyInherited(propertyName) {
    return false;
  }

  /**
   * @override
   * @param {!SDK.CSSProperty} property
   * @return {boolean}
   */
  _isPropertyOverloaded(property) {
    return false;
  }

  /**
   * @override
   */
  _markSelectorHighlights() {
  }

  /**
   * @override
   */
  _markSelectorMatches() {
    this._selectorElement.textContent = this._style.parentRule.key().text;
  }

  /**
   * @override
   */
  _highlight() {
  }
};

Elements.StylePropertyTreeElement = class extends UI.TreeElement {
  /**
   * @param {!Elements.StylesSidebarPane} stylesPane
   * @param {!SDK.CSSMatchedStyles} matchedStyles
   * @param {!SDK.CSSProperty} property
   * @param {boolean} isShorthand
   * @param {boolean} inherited
   * @param {boolean} overloaded
   * @param {boolean} newProperty
   */
  constructor(stylesPane, matchedStyles, property, isShorthand, inherited, overloaded, newProperty) {
    // Pass an empty title, the title gets made later in onattach.
    super('', isShorthand);
    this._style = property.ownerStyle;
    this._matchedStyles = matchedStyles;
    this.property = property;
    this._inherited = inherited;
    this._overloaded = overloaded;
    this.selectable = false;
    this._parentPane = stylesPane;
    this.isShorthand = isShorthand;
    this._applyStyleThrottler = new Common.Throttler(0);
    this._newProperty = newProperty;
    if (this._newProperty)
      this.listItemElement.textContent = '';
    this._expandedDueToFilter = false;
    this.valueElement = null;
    this.nameElement = null;
    this._expandElement = null;
    this._originalPropertyText = '';
    this._prompt = null;
    this._propertyHasBeenEditedIncrementally = false;
  }

  /**
   * @return {boolean}
   */
  _editable() {
    return !!(this._style.styleSheetId && this._style.range);
  }

  /**
   * @return {boolean}
   */
  inherited() {
    return this._inherited;
  }

  /**
   * @return {boolean}
   */
  overloaded() {
    return this._overloaded;
  }

  /**
   * @param {boolean} x
   */
  setOverloaded(x) {
    if (x === this._overloaded)
      return;
    this._overloaded = x;
    this._updateState();
  }

  get name() {
    return this.property.name;
  }

  get value() {
    return this.property.value;
  }

  /**
   * @return {boolean}
   */
  _updateFilter() {
    var regex = this._parentPane.filterRegex();
    var matches = !!regex && (regex.test(this.property.name) || regex.test(this.property.value));
    this.listItemElement.classList.toggle('filter-match', matches);

    this.onpopulate();
    var hasMatchingChildren = false;
    for (var i = 0; i < this.childCount(); ++i)
      hasMatchingChildren |= this.childAt(i)._updateFilter();

    if (!regex) {
      if (this._expandedDueToFilter)
        this.collapse();
      this._expandedDueToFilter = false;
    } else if (hasMatchingChildren && !this.expanded) {
      this.expand();
      this._expandedDueToFilter = true;
    } else if (!hasMatchingChildren && this.expanded && this._expandedDueToFilter) {
      this.collapse();
      this._expandedDueToFilter = false;
    }
    return matches;
  }

  /**
   * @param {string} text
   * @return {!Node}
   */
  _processColor(text) {
    // We can be called with valid non-color values of |text| (like 'none' from border style)
    var color = Common.Color.parse(text);
    if (!color)
      return createTextNode(text);

    if (!this._editable()) {
      var swatch = InlineEditor.ColorSwatch.create();
      swatch.setColor(color);
      return swatch;
    }

    var swatchPopoverHelper = this._parentPane.swatchPopoverHelper();
    var swatch = InlineEditor.ColorSwatch.create();
    swatch.setColor(color);
    swatch.setFormat(Common.Color.detectColorFormat(swatch.color()));
    var swatchIcon = new Elements.ColorSwatchPopoverIcon(this, swatchPopoverHelper, swatch);

    /**
     * @param {?SDK.CSSModel.ContrastInfo} contrastInfo
     */
    function computedCallback(contrastInfo) {
      swatchIcon.setContrastInfo(contrastInfo);
    }

    if (Runtime.experiments.isEnabled('colorContrastRatio') && this.property.name === 'color' &&
        this._parentPane.cssModel() && this.node()) {
      var cssModel = this._parentPane.cssModel();
      cssModel.backgroundColorsPromise(this.node().id).then(computedCallback);
    }

    return swatch;
  }

  /**
   * @return {string}
   */
  renderedPropertyText() {
    return this.nameElement.textContent + ': ' + this.valueElement.textContent;
  }

  /**
   * @param {string} text
   * @return {!Node}
   */
  _processBezier(text) {
    if (!this._editable() || !UI.Geometry.CubicBezier.parse(text))
      return createTextNode(text);
    var swatchPopoverHelper = this._parentPane.swatchPopoverHelper();
    var swatch = InlineEditor.BezierSwatch.create();
    swatch.setBezierText(text);
    new Elements.BezierPopoverIcon(this, swatchPopoverHelper, swatch);
    return swatch;
  }

  /**
   * @param {string} propertyValue
   * @param {string} propertyName
   * @return {!Node}
   */
  _processShadow(propertyValue, propertyName) {
    if (!this._editable())
      return createTextNode(propertyValue);
    var shadows;
    if (propertyName === 'text-shadow')
      shadows = InlineEditor.CSSShadowModel.parseTextShadow(propertyValue);
    else
      shadows = InlineEditor.CSSShadowModel.parseBoxShadow(propertyValue);
    if (!shadows.length)
      return createTextNode(propertyValue);
    var container = createDocumentFragment();
    var swatchPopoverHelper = this._parentPane.swatchPopoverHelper();
    for (var i = 0; i < shadows.length; i++) {
      if (i !== 0)
        container.appendChild(createTextNode(', '));  // Add back commas and spaces between each shadow.
      // TODO(flandy): editing the property value should use the original value with all spaces.
      var cssShadowSwatch = InlineEditor.CSSShadowSwatch.create();
      cssShadowSwatch.setCSSShadow(shadows[i]);
      new Elements.ShadowSwatchPopoverHelper(this, swatchPopoverHelper, cssShadowSwatch);
      var colorSwatch = cssShadowSwatch.colorSwatch();
      if (colorSwatch)
        new Elements.ColorSwatchPopoverIcon(this, swatchPopoverHelper, colorSwatch);
      container.appendChild(cssShadowSwatch);
    }
    return container;
  }

  _updateState() {
    if (!this.listItemElement)
      return;

    if (this._style.isPropertyImplicit(this.name))
      this.listItemElement.classList.add('implicit');
    else
      this.listItemElement.classList.remove('implicit');

    var hasIgnorableError =
        !this.property.parsedOk && Elements.StylesSidebarPane.ignoreErrorsForProperty(this.property);
    if (hasIgnorableError)
      this.listItemElement.classList.add('has-ignorable-error');
    else
      this.listItemElement.classList.remove('has-ignorable-error');

    if (this.inherited())
      this.listItemElement.classList.add('inherited');
    else
      this.listItemElement.classList.remove('inherited');

    if (this.overloaded())
      this.listItemElement.classList.add('overloaded');
    else
      this.listItemElement.classList.remove('overloaded');

    if (this.property.disabled)
      this.listItemElement.classList.add('disabled');
    else
      this.listItemElement.classList.remove('disabled');
  }

  /**
   * @return {?SDK.DOMNode}
   */
  node() {
    return this._parentPane.node();
  }

  /**
   * @return {!Elements.StylesSidebarPane}
   */
  parentPane() {
    return this._parentPane;
  }

  /**
   * @return {?Elements.StylePropertiesSection}
   */
  section() {
    return this.treeOutline && this.treeOutline.section;
  }

  _updatePane() {
    var section = this.section();
    if (section)
      section.refreshUpdate();
  }

  /**
   * @param {!Event} event
   */
  _toggleEnabled(event) {
    var disabled = !event.target.checked;
    var oldStyleRange = this._style.range;
    if (!oldStyleRange)
      return;

    /**
     * @param {boolean} success
     * @this {Elements.StylePropertyTreeElement}
     */
    function callback(success) {
      this._parentPane.setUserOperation(false);

      if (!success)
        return;
      this._matchedStyles.resetActiveProperties();
      this._updatePane();
      this.styleTextAppliedForTest();
    }

    event.consume();
    this._parentPane.setUserOperation(true);
    this.property.setDisabled(disabled).then(callback.bind(this));
  }

  /**
   * @override
   */
  onpopulate() {
    // Only populate once and if this property is a shorthand.
    if (this.childCount() || !this.isShorthand)
      return;

    var longhandProperties = this._style.longhandProperties(this.name);
    for (var i = 0; i < longhandProperties.length; ++i) {
      var name = longhandProperties[i].name;
      var inherited = false;
      var overloaded = false;

      var section = this.section();
      if (section) {
        inherited = section.isPropertyInherited(name);
        overloaded =
            this._matchedStyles.propertyState(longhandProperties[i]) === SDK.CSSMatchedStyles.PropertyState.Overloaded;
      }

      var item = new Elements.StylePropertyTreeElement(
          this._parentPane, this._matchedStyles, longhandProperties[i], false, inherited, overloaded, false);
      this.appendChild(item);
    }
  }

  /**
   * @override
   */
  onattach() {
    this.updateTitle();

    this.listItemElement.addEventListener('mousedown', event => {
      if (event.which === 1)
        this._parentPane[Elements.StylePropertyTreeElement.ActiveSymbol] = this;
    }, false);
    this.listItemElement.addEventListener('mouseup', this._mouseUp.bind(this));
    this.listItemElement.addEventListener('click', event => {
      if (!event.target.hasSelection() && event.target !== this.listItemElement)
        event.consume(true);
    });
  }

  /**
   * @override
   */
  onexpand() {
    this._updateExpandElement();
  }

  /**
   * @override
   */
  oncollapse() {
    this._updateExpandElement();
  }

  _updateExpandElement() {
    if (!this._expandElement)
      return;
    if (this.expanded)
      this._expandElement.setIconType('smallicon-triangle-down');
    else
      this._expandElement.setIconType('smallicon-triangle-right');
  }

  updateTitle() {
    this._updateState();
    if (this.isExpandable())
      this._expandElement = UI.Icon.create('smallicon-triangle-right', 'expand-icon');
    else
      this._expandElement = null;

    var propertyRenderer =
        new Elements.StylesSidebarPropertyRenderer(this._style.parentRule, this.node(), this.name, this.value);
    if (this.property.parsedOk) {
      propertyRenderer.setColorHandler(this._processColor.bind(this));
      propertyRenderer.setBezierHandler(this._processBezier.bind(this));
      propertyRenderer.setShadowHandler(this._processShadow.bind(this));
    }

    this.listItemElement.removeChildren();
    this.nameElement = propertyRenderer.renderName();
    this.valueElement = propertyRenderer.renderValue();
    if (!this.treeOutline)
      return;

    var indent = Common.moduleSetting('textEditorIndent').get();
    this.listItemElement.createChild('span', 'styles-clipboard-only')
        .createTextChild(indent + (this.property.disabled ? '/* ' : ''));
    this.listItemElement.appendChild(this.nameElement);
    this.listItemElement.createTextChild(': ');
    if (this._expandElement)
      this.listItemElement.appendChild(this._expandElement);
    this.listItemElement.appendChild(this.valueElement);
    this.listItemElement.createTextChild(';');
    if (this.property.disabled)
      this.listItemElement.createChild('span', 'styles-clipboard-only').createTextChild(' */');

    if (!this.property.parsedOk) {
      // Avoid having longhands under an invalid shorthand.
      this.listItemElement.classList.add('not-parsed-ok');

      // Add a separate exclamation mark IMG element with a tooltip.
      this.listItemElement.insertBefore(
          Elements.StylesSidebarPane.createExclamationMark(this.property), this.listItemElement.firstChild);
    }
    if (!this.property.activeInStyle())
      this.listItemElement.classList.add('inactive');
    this._updateFilter();

    if (this.property.parsedOk && this.section() && this.parent.root) {
      var enabledCheckboxElement = createElement('input');
      enabledCheckboxElement.className = 'enabled-button';
      enabledCheckboxElement.type = 'checkbox';
      enabledCheckboxElement.checked = !this.property.disabled;
      enabledCheckboxElement.addEventListener('mousedown', event => event.consume(), false);
      enabledCheckboxElement.addEventListener('click', this._toggleEnabled.bind(this), false);
      this.listItemElement.insertBefore(enabledCheckboxElement, this.listItemElement.firstChild);
    }
  }

  /**
   * @param {!Event} event
   */
  _mouseUp(event) {
    var activeTreeElement = this._parentPane[Elements.StylePropertyTreeElement.ActiveSymbol];
    this._parentPane[Elements.StylePropertyTreeElement.ActiveSymbol] = null;
    if (activeTreeElement !== this)
      return;
    if (this.listItemElement.hasSelection())
      return;
    if (UI.isBeingEdited(/** @type {!Node} */ (event.target)))
      return;

    event.consume(true);

    if (event.target === this.listItemElement)
      return;

    if (UI.KeyboardShortcut.eventHasCtrlOrMeta(/** @type {!MouseEvent} */ (event)) && this.section().navigable) {
      this._navigateToSource(/** @type {!Element} */ (event.target));
      return;
    }

    this.startEditing(/** @type {!Element} */ (event.target));
  }

  /**
   * @param {!Element} element
   * @param {boolean=} omitFocus
   */
  _navigateToSource(element, omitFocus) {
    if (!this.section().navigable)
      return;
    var propertyNameClicked = element === this.nameElement;
    var uiLocation = Bindings.cssWorkspaceBinding.propertyUILocation(this.property, propertyNameClicked);
    if (uiLocation)
      Common.Revealer.reveal(uiLocation, omitFocus);
  }

  /**
   * @param {?Element=} selectElement
   */
  startEditing(selectElement) {
    // FIXME: we don't allow editing of longhand properties under a shorthand right now.
    if (this.parent.isShorthand)
      return;

    if (this._expandElement && selectElement === this._expandElement)
      return;

    var section = this.section();
    if (section && !section.editable)
      return;

    if (selectElement) {
      selectElement = selectElement.enclosingNodeOrSelfWithClass('webkit-css-property') ||
          selectElement.enclosingNodeOrSelfWithClass('value');
    }
    if (!selectElement)
      selectElement = this.nameElement;

    if (UI.isBeingEdited(selectElement))
      return;

    var isEditingName = selectElement === this.nameElement;
    if (!isEditingName)
      this.valueElement.textContent = restoreURLs(this.valueElement.textContent, this.value);

    /**
     * @param {string} fieldValue
     * @param {string} modelValue
     * @return {string}
     */
    function restoreURLs(fieldValue, modelValue) {
      const urlRegex = /\b(url\([^)]*\))/g;
      var splitFieldValue = fieldValue.split(urlRegex);
      if (splitFieldValue.length === 1)
        return fieldValue;
      var modelUrlRegex = new RegExp(urlRegex);
      for (var i = 1; i < splitFieldValue.length; i += 2) {
        var match = modelUrlRegex.exec(modelValue);
        if (match)
          splitFieldValue[i] = match[0];
      }
      return splitFieldValue.join('');
    }

    /** @type {!Elements.StylePropertyTreeElement.Context} */
    var context = {
      expanded: this.expanded,
      hasChildren: this.isExpandable(),
      isEditingName: isEditingName,
      previousContent: selectElement.textContent
    };

    // Lie about our children to prevent expanding on double click and to collapse shorthands.
    this.setExpandable(false);

    if (selectElement.parentElement)
      selectElement.parentElement.classList.add('child-editing');
    selectElement.textContent = selectElement.textContent;  // remove color swatch and the like

    /**
     * @param {!Elements.StylePropertyTreeElement.Context} context
     * @param {!Event} event
     * @this {Elements.StylePropertyTreeElement}
     */
    function pasteHandler(context, event) {
      var data = event.clipboardData.getData('Text');
      if (!data)
        return;
      var colonIdx = data.indexOf(':');
      if (colonIdx < 0)
        return;
      var name = data.substring(0, colonIdx).trim();
      var value = data.substring(colonIdx + 1).trim();

      event.preventDefault();

      if (!('originalName' in context)) {
        context.originalName = this.nameElement.textContent;
        context.originalValue = this.valueElement.textContent;
      }
      this.property.name = name;
      this.property.value = value;
      this.nameElement.textContent = name;
      this.valueElement.textContent = value;
      this.nameElement.normalize();
      this.valueElement.normalize();

      this._editingCommitted(event.target.textContent, context, 'forward');
    }

    /**
     * @param {!Elements.StylePropertyTreeElement.Context} context
     * @param {!Event} event
     * @this {Elements.StylePropertyTreeElement}
     */
    function blurListener(context, event) {
      var text = event.target.textContent;
      if (!context.isEditingName)
        text = this.value || text;
      this._editingCommitted(text, context, '');
    }

    this._originalPropertyText = this.property.propertyText;

    this._parentPane.setEditingStyle(true);
    if (selectElement.parentElement)
      selectElement.parentElement.scrollIntoViewIfNeeded(false);

    var cssCompletions = [];
    if (isEditingName) {
      cssCompletions = SDK.cssMetadata().allProperties();
      if (!this.node().isSVGNode())
        cssCompletions = cssCompletions.filter(property => !SDK.cssMetadata().isSVGProperty(property));
    } else {
      cssCompletions = SDK.cssMetadata().propertyValues(this.nameElement.textContent);
    }
    var cssVariables = this._matchedStyles.cssVariables().sort(String.naturalOrderComparator);

    this._prompt = new Elements.StylesSidebarPane.CSSPropertyPrompt(cssCompletions, cssVariables, this, isEditingName);
    this._prompt.setAutocompletionTimeout(0);
    if (section)
      section.startEditing();

    // Do not live-edit "content" property of pseudo elements. crbug.com/433889
    if (!isEditingName && (!this._parentPane.node().pseudoType() || this.name !== 'content'))
      this._prompt.addEventListener(UI.TextPrompt.Events.TextChanged, this._applyFreeFlowStyleTextEdit.bind(this));

    var proxyElement = this._prompt.attachAndStartEditing(selectElement, blurListener.bind(this, context));
    this._navigateToSource(selectElement, true);

    proxyElement.addEventListener('keydown', this._editingNameValueKeyDown.bind(this, context), false);
    proxyElement.addEventListener('keypress', this._editingNameValueKeyPress.bind(this, context), false);
    if (isEditingName)
      proxyElement.addEventListener('paste', pasteHandler.bind(this, context), false);

    selectElement.getComponentSelection().selectAllChildren(selectElement);
  }

  /**
   * @param {!Elements.StylePropertyTreeElement.Context} context
   * @param {!Event} event
   */
  _editingNameValueKeyDown(context, event) {
    if (event.handled)
      return;

    var result;

    if (isEnterKey(event)) {
      result = 'forward';
    } else if (event.keyCode === UI.KeyboardShortcut.Keys.Esc.code || event.key === 'Escape') {
      result = 'cancel';
    } else if (
        !context.isEditingName && this._newProperty && event.keyCode === UI.KeyboardShortcut.Keys.Backspace.code) {
      // For a new property, when Backspace is pressed at the beginning of new property value, move back to the property name.
      var selection = event.target.getComponentSelection();
      if (selection.isCollapsed && !selection.focusOffset) {
        event.preventDefault();
        result = 'backward';
      }
    } else if (event.key === 'Tab') {
      result = event.shiftKey ? 'backward' : 'forward';
      event.preventDefault();
    }

    if (result) {
      switch (result) {
        case 'cancel':
          this.editingCancelled(null, context);
          break;
        case 'forward':
        case 'backward':
          this._editingCommitted(event.target.textContent, context, result);
          break;
      }

      event.consume();
      return;
    }
  }

  /**
   * @param {!Elements.StylePropertyTreeElement.Context} context
   * @param {!Event} event
   */
  _editingNameValueKeyPress(context, event) {
    /**
     * @param {string} text
     * @param {number} cursorPosition
     * @return {boolean}
     */
    function shouldCommitValueSemicolon(text, cursorPosition) {
      // FIXME: should this account for semicolons inside comments?
      var openQuote = '';
      for (var i = 0; i < cursorPosition; ++i) {
        var ch = text[i];
        if (ch === '\\' && openQuote !== '')
          ++i;  // skip next character inside string
        else if (!openQuote && (ch === '"' || ch === '\''))
          openQuote = ch;
        else if (openQuote === ch)
          openQuote = '';
      }
      return !openQuote;
    }

    var keyChar = String.fromCharCode(event.charCode);
    var isFieldInputTerminated =
        (context.isEditingName ? keyChar === ':' :
                                 keyChar === ';' &&
                 shouldCommitValueSemicolon(event.target.textContent, event.target.selectionLeftOffset()));
    if (isFieldInputTerminated) {
      // Enter or colon (for name)/semicolon outside of string (for value).
      event.consume(true);
      this._editingCommitted(event.target.textContent, context, 'forward');
      return;
    }
  }

  /**
   * @return {!Promise}
   */
  async _applyFreeFlowStyleTextEdit() {
    var valueText = this._prompt.textWithCurrentSuggestion();
    if (valueText.indexOf(';') === -1)
      await this.applyStyleText(this.nameElement.textContent + ': ' + valueText, false);
  }

  /**
   * @return {!Promise}
   */
  kickFreeFlowStyleEditForTest() {
    return this._applyFreeFlowStyleTextEdit();
  }

  /**
   * @param {!Elements.StylePropertyTreeElement.Context} context
   */
  editingEnded(context) {
    this.setExpandable(context.hasChildren);
    if (context.expanded)
      this.expand();
    var editedElement = context.isEditingName ? this.nameElement : this.valueElement;
    // The proxyElement has been deleted, no need to remove listener.
    if (editedElement.parentElement)
      editedElement.parentElement.classList.remove('child-editing');

    this._parentPane.setEditingStyle(false);
  }

  /**
   * @param {?Element} element
   * @param {!Elements.StylePropertyTreeElement.Context} context
   */
  editingCancelled(element, context) {
    this._removePrompt();
    this._revertStyleUponEditingCanceled();
    // This should happen last, as it clears the info necessary to restore the property value after [Page]Up/Down changes.
    this.editingEnded(context);
  }

  _revertStyleUponEditingCanceled() {
    if (this._propertyHasBeenEditedIncrementally) {
      this.applyStyleText(this._originalPropertyText, false);
      this._originalPropertyText = '';
    } else if (this._newProperty) {
      this.treeOutline.removeChild(this);
    } else {
      this.updateTitle();
    }
  }

  /**
   * @param {string} moveDirection
   * @return {?Elements.StylePropertyTreeElement}
   */
  _findSibling(moveDirection) {
    var target = this;
    do
      target = (moveDirection === 'forward' ? target.nextSibling : target.previousSibling);
    while (target && target.inherited());

    return target;
  }

  /**
   * @param {string} userInput
   * @param {!Elements.StylePropertyTreeElement.Context} context
   * @param {string} moveDirection
   */
  async _editingCommitted(userInput, context, moveDirection) {
    var hadFocus = this._parentPane.element.hasFocus();
    this._removePrompt();
    this.editingEnded(context);
    var isEditingName = context.isEditingName;

    // Determine where to move to before making changes
    var createNewProperty, moveToSelector;
    var isDataPasted = 'originalName' in context;
    var isDirtyViaPaste = isDataPasted && (this.nameElement.textContent !== context.originalName ||
                                           this.valueElement.textContent !== context.originalValue);
    var isPropertySplitPaste = isDataPasted && isEditingName && this.valueElement.textContent !== context.originalValue;
    var moveTo = this;
    var moveToOther = (isEditingName ^ (moveDirection === 'forward'));
    var abandonNewProperty = this._newProperty && !userInput && (moveToOther || isEditingName);
    if (moveDirection === 'forward' && (!isEditingName || isPropertySplitPaste) ||
        moveDirection === 'backward' && isEditingName) {
      moveTo = moveTo._findSibling(moveDirection);
      if (!moveTo) {
        if (moveDirection === 'forward' && (!this._newProperty || userInput))
          createNewProperty = true;
        else if (moveDirection === 'backward')
          moveToSelector = true;
      }
    }

    // Make the Changes and trigger the moveToNextCallback after updating.
    var moveToIndex = moveTo && this.treeOutline ? this.treeOutline.rootElement().indexOfChild(moveTo) : -1;
    var blankInput = userInput.isWhitespace();
    var shouldCommitNewProperty = this._newProperty &&
        (isPropertySplitPaste || moveToOther || (!moveDirection && !isEditingName) || (isEditingName && blankInput));
    var section = /** @type {!Elements.StylePropertiesSection} */ (this.section());
    if (((userInput !== context.previousContent || isDirtyViaPaste) && !this._newProperty) || shouldCommitNewProperty) {
      if (hadFocus)
        this._parentPane.element.focus();
      var propertyText;
      if (blankInput || (this._newProperty && this.valueElement.textContent.isWhitespace())) {
        propertyText = '';
      } else {
        if (isEditingName)
          propertyText = userInput + ': ' + this.property.value;
        else
          propertyText = this.property.name + ': ' + userInput;
      }
      await this.applyStyleText(propertyText, true);
      moveToNextCallback.call(this, this._newProperty, !blankInput, section);
    } else {
      if (isEditingName)
        this.property.name = userInput;
      else
        this.property.value = userInput;
      if (!isDataPasted && !this._newProperty)
        this.updateTitle();
      moveToNextCallback.call(this, this._newProperty, false, section);
    }

    /**
     * The Callback to start editing the next/previous property/selector.
     * @param {boolean} alreadyNew
     * @param {boolean} valueChanged
     * @param {!Elements.StylePropertiesSection} section
     * @this {Elements.StylePropertyTreeElement}
     */
    function moveToNextCallback(alreadyNew, valueChanged, section) {
      if (!moveDirection)
        return;

      // User just tabbed through without changes.
      if (moveTo && moveTo.parent) {
        moveTo.startEditing(!isEditingName ? moveTo.nameElement : moveTo.valueElement);
        return;
      }

      // User has made a change then tabbed, wiping all the original treeElements.
      // Recalculate the new treeElement for the same property we were going to edit next.
      if (moveTo && !moveTo.parent) {
        var rootElement = section.propertiesTreeOutline.rootElement();
        if (moveDirection === 'forward' && blankInput && !isEditingName)
          --moveToIndex;
        if (moveToIndex >= rootElement.childCount() && !this._newProperty) {
          createNewProperty = true;
        } else {
          var treeElement = moveToIndex >= 0 ? rootElement.childAt(moveToIndex) : null;
          if (treeElement) {
            var elementToEdit =
                !isEditingName || isPropertySplitPaste ? treeElement.nameElement : treeElement.valueElement;
            if (alreadyNew && blankInput)
              elementToEdit = moveDirection === 'forward' ? treeElement.nameElement : treeElement.valueElement;
            treeElement.startEditing(elementToEdit);
            return;
          } else if (!alreadyNew) {
            moveToSelector = true;
          }
        }
      }

      // Create a new attribute in this section (or move to next editable selector if possible).
      if (createNewProperty) {
        if (alreadyNew && !valueChanged && (isEditingName ^ (moveDirection === 'backward')))
          return;

        section.addNewBlankProperty().startEditing();
        return;
      }

      if (abandonNewProperty) {
        moveTo = this._findSibling(moveDirection);
        var sectionToEdit = (moveTo || moveDirection === 'backward') ? section : section.nextEditableSibling();
        if (sectionToEdit) {
          if (sectionToEdit.style().parentRule)
            sectionToEdit.startEditingSelector();
          else
            sectionToEdit.moveEditorFromSelector(moveDirection);
        }
        return;
      }

      if (moveToSelector) {
        if (section.style().parentRule)
          section.startEditingSelector();
        else
          section.moveEditorFromSelector(moveDirection);
      }
    }
  }

  _removePrompt() {
    // BUG 53242. This cannot go into editingEnded(), as it should always happen first for any editing outcome.
    if (this._prompt) {
      this._prompt.detach();
      this._prompt = null;
    }
    var section = this.section();
    if (section)
      section.stopEditing();
  }

  styleTextAppliedForTest() {
  }

  /**
   * @param {string} styleText
   * @param {boolean} majorChange
   * @return {!Promise}
   */
  applyStyleText(styleText, majorChange) {
    return this._applyStyleThrottler.schedule(this._innerApplyStyleText.bind(this, styleText, majorChange));
  }

  /**
   * @param {string} styleText
   * @param {boolean} majorChange
   * @return {!Promise}
   */
  async _innerApplyStyleText(styleText, majorChange) {
    if (!this.treeOutline)
      return;

    var oldStyleRange = this._style.range;
    if (!oldStyleRange)
      return;

    styleText = styleText.replace(/\s/g, ' ').trim();  // Replace &nbsp; with whitespace.
    if (!styleText.length && majorChange && this._newProperty && !this._propertyHasBeenEditedIncrementally) {
      // The user deleted everything and never applied a new property value via Up/Down scrolling/live editing, so remove the tree element and update.
      this.parent.removeChild(this);
      return;
    }

    var currentNode = this._parentPane.node();
    this._parentPane.setUserOperation(true);

    // Append a ";" if the new text does not end in ";".
    // FIXME: this does not handle trailing comments.
    if (styleText.length && !/;\s*$/.test(styleText))
      styleText += ';';
    var overwriteProperty = !this._newProperty || this._propertyHasBeenEditedIncrementally;
    var success = await this.property.setText(styleText, majorChange, overwriteProperty);
    // Revert to the original text if applying the new text failed
    if (this._propertyHasBeenEditedIncrementally && majorChange && !success) {
      majorChange = false;
      success = await this.property.setText(this._originalPropertyText, majorChange, overwriteProperty);
    }
    this._parentPane.setUserOperation(false);

    if (!success) {
      if (majorChange) {
        // It did not apply, cancel editing.
        if (this._newProperty)
          this.treeOutline.removeChild(this);
        else
          this.updateTitle();
      }
      this.styleTextAppliedForTest();
      return;
    }

    this._matchedStyles.resetActiveProperties();
    this._propertyHasBeenEditedIncrementally = true;
    this.property = this._style.propertyAt(this.property.index);

    if (currentNode === this.node())
      this._updatePane();

    this.styleTextAppliedForTest();
  }

  /**
   * @override
   * @return {boolean}
   */
  ondblclick() {
    return true;  // handled
  }

  /**
   * @override
   * @param {!Event} event
   * @return {boolean}
   */
  isEventWithinDisclosureTriangle(event) {
    return event.target === this._expandElement;
  }
};

/** @typedef {{expanded: boolean, hasChildren: boolean, isEditingName: boolean, previousContent: string}} */
Elements.StylePropertyTreeElement.Context;
Elements.StylePropertyTreeElement.ActiveSymbol = Symbol('ActiveSymbol');

Elements.StylesSidebarPane.CSSPropertyPrompt = class extends UI.TextPrompt {
  /**
   * @param {!Array<string>} cssCompletions
   * @param {!Array<string>} cssVariables
   * @param {!Elements.StylePropertyTreeElement} treeElement
   * @param {boolean} isEditingName
   */
  constructor(cssCompletions, cssVariables, treeElement, isEditingName) {
    // Use the same callback both for applyItemCallback and acceptItemCallback.
    super();
    this.initialize(this._buildPropertyCompletions.bind(this), UI.StyleValueDelimiters);
    this._cssCompletions = cssCompletions;
    this._cssVariables = cssVariables;
    this._treeElement = treeElement;
    this._isEditingName = isEditingName;

    if (!isEditingName) {
      this.disableDefaultSuggestionForEmptyInput();

      // If a CSS value is being edited that has a numeric or hex substring, hint that precision modifier shortcuts are available.
      if (treeElement && treeElement.valueElement) {
        var cssValueText = treeElement.valueElement.textContent;
        if (cssValueText.match(/#[\da-f]{3,6}$/i)) {
          this.setTitle(Common.UIString(
              'Increment/decrement with mousewheel or up/down keys. %s: R ±1, Shift: G ±1, Alt: B ±1',
              Host.isMac() ? 'Cmd' : 'Ctrl'));
        } else if (cssValueText.match(/\d+/)) {
          this.setTitle(Common.UIString(
              'Increment/decrement with mousewheel or up/down keys. %s: ±100, Shift: ±10, Alt: ±0.1',
              Host.isMac() ? 'Cmd' : 'Ctrl'));
        }
      }
    }
  }

  /**
   * @override
   * @param {!Event} event
   */
  onKeyDown(event) {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'PageUp':
      case 'PageDown':
        if (this._handleNameOrValueUpDown(event)) {
          event.preventDefault();
          return;
        }
        break;
      case 'Enter':
        // Accept any available autocompletions and advance to the next field.
        if (this.textWithCurrentSuggestion() !== this.text()) {
          this.tabKeyPressed();
          return;
        }
        break;
    }

    super.onKeyDown(event);
  }

  /**
   * @override
   * @param {!Event} event
   */
  onMouseWheel(event) {
    if (this._handleNameOrValueUpDown(event)) {
      event.consume(true);
      return;
    }
    super.onMouseWheel(event);
  }

  /**
   * @override
   * @return {boolean}
   */
  tabKeyPressed() {
    this.acceptAutoComplete();

    // Always tab to the next field.
    return false;
  }

  /**
   * @param {!Event} event
   * @return {boolean}
   */
  _handleNameOrValueUpDown(event) {
    /**
     * @param {string} originalValue
     * @param {string} replacementString
     * @this {Elements.StylesSidebarPane.CSSPropertyPrompt}
     */
    function finishHandler(originalValue, replacementString) {
      // Synthesize property text disregarding any comments, custom whitespace etc.
      this._treeElement.applyStyleText(
          this._treeElement.nameElement.textContent + ': ' + this._treeElement.valueElement.textContent, false);
    }

    /**
     * @param {string} prefix
     * @param {number} number
     * @param {string} suffix
     * @return {string}
     * @this {Elements.StylesSidebarPane.CSSPropertyPrompt}
     */
    function customNumberHandler(prefix, number, suffix) {
      if (number !== 0 && !suffix.length && SDK.cssMetadata().isLengthProperty(this._treeElement.property.name))
        suffix = 'px';
      return prefix + number + suffix;
    }

    // Handle numeric value increment/decrement only at this point.
    if (!this._isEditingName && this._treeElement.valueElement &&
        UI.handleElementValueModifications(
            event, this._treeElement.valueElement, finishHandler.bind(this), this._isValueSuggestion.bind(this),
            customNumberHandler.bind(this)))
      return true;

    return false;
  }

  /**
   * @param {string} word
   * @return {boolean}
   */
  _isValueSuggestion(word) {
    if (!word)
      return false;
    word = word.toLowerCase();
    return this._cssCompletions.indexOf(word) !== -1 || word.startsWith('--');
  }

  /**
   * @param {string} expression
   * @param {string} query
   * @param {boolean=} force
   * @return {!Promise<!UI.SuggestBox.Suggestions>}
   */
  _buildPropertyCompletions(expression, query, force) {
    var lowerQuery = query.toLowerCase();
    var editingVariable = !this._isEditingName && expression.trim().endsWith('var(');
    if (!query && !force && !editingVariable && (this._isEditingName || expression))
      return Promise.resolve([]);

    var prefixResults = [];
    var anywhereResults = [];
    if (!editingVariable)
      this._cssCompletions.forEach(filterCompletions.bind(this));
    if (this._isEditingName || editingVariable)
      this._cssVariables.forEach(filterCompletions.bind(this));

    var results = prefixResults.concat(anywhereResults);
    if (!this._isEditingName && !results.length && query.length > 1 && '!important'.startsWith(lowerQuery))
      results.push({text: '!important'});
    var userEnteredText = query.replace('-', '');
    if (userEnteredText && (userEnteredText === userEnteredText.toUpperCase())) {
      for (var i = 0; i < results.length; ++i) {
        if (!results[i].text.startsWith('--'))
          results[i].text = results[i].text.toUpperCase();
      }
    }
    if (editingVariable)
      results.forEach(result => result.text += ')');
    return Promise.resolve(results);

    /**
     * @param {string} completion
     * @this {Elements.StylesSidebarPane.CSSPropertyPrompt}
     */
    function filterCompletions(completion) {
      var index = completion.toLowerCase().indexOf(lowerQuery);
      if (index === 0) {
        var priority = this._isEditingName ? SDK.cssMetadata().propertyUsageWeight(completion) : 1;
        prefixResults.push({text: completion, priority: priority});
      } else if (index > -1) {
        anywhereResults.push({text: completion});
      }
    }
  }
};

Elements.StylesSidebarPropertyRenderer = class {
  /**
   * @param {?SDK.CSSRule} rule
   * @param {?SDK.DOMNode} node
   * @param {string} name
   * @param {string} value
   */
  constructor(rule, node, name, value) {
    this._rule = rule;
    this._node = node;
    this._propertyName = name;
    this._propertyValue = value;
    /** @type {?function(string):!Node} */
    this._colorHandler = null;
    /** @type {?function(string):!Node} */
    this._bezierHandler = null;
    /** @type {?function(string, string):!Node} */
    this._shadowHandler = null;
  }

  /**
   * @param {function(string):!Node} handler
   */
  setColorHandler(handler) {
    this._colorHandler = handler;
  }

  /**
   * @param {function(string):!Node} handler
   */
  setBezierHandler(handler) {
    this._bezierHandler = handler;
  }

  /**
   * @param {function(string, string):!Node} handler
   */
  setShadowHandler(handler) {
    this._shadowHandler = handler;
  }

  /**
   * @return {!Element}
   */
  renderName() {
    var nameElement = createElement('span');
    nameElement.className = 'webkit-css-property';
    nameElement.textContent = this._propertyName;
    nameElement.normalize();
    return nameElement;
  }

  /**
   * @return {!Element}
   */
  renderValue() {
    var valueElement = createElement('span');
    valueElement.className = 'value';
    if (!this._propertyValue)
      return valueElement;

    if (this._shadowHandler && (this._propertyName === 'box-shadow' || this._propertyName === 'text-shadow' ||
                                this._propertyName === '-webkit-box-shadow') &&
        !SDK.CSSMetadata.VariableRegex.test(this._propertyValue)) {
      valueElement.appendChild(this._shadowHandler(this._propertyValue, this._propertyName));
      valueElement.normalize();
      return valueElement;
    }

    var regexes = [SDK.CSSMetadata.VariableRegex, SDK.CSSMetadata.URLRegex];
    var processors = [createTextNode, this._processURL.bind(this)];
    if (this._bezierHandler && SDK.cssMetadata().isBezierAwareProperty(this._propertyName)) {
      regexes.push(UI.Geometry.CubicBezier.Regex);
      processors.push(this._bezierHandler);
    }
    if (this._colorHandler && SDK.cssMetadata().isColorAwareProperty(this._propertyName)) {
      regexes.push(Common.Color.Regex);
      processors.push(this._colorHandler);
    }
    var results = TextUtils.TextUtils.splitStringByRegexes(this._propertyValue, regexes);
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var processor = result.regexIndex === -1 ? createTextNode : processors[result.regexIndex];
      valueElement.appendChild(processor(result.value));
    }
    valueElement.normalize();
    return valueElement;
  }

  /**
   * @param {string} text
   * @return {!Node}
   */
  _processURL(text) {
    // Strip "url(" and ")" along with whitespace.
    var url = text.substring(4, text.length - 1).trim();
    var isQuoted = /^'.*'$/.test(url) || /^".*"$/.test(url);
    if (isQuoted)
      url = url.substring(1, url.length - 1);
    var container = createDocumentFragment();
    container.createTextChild('url(');
    var hrefUrl = null;
    if (this._rule && this._rule.resourceURL())
      hrefUrl = Common.ParsedURL.completeURL(this._rule.resourceURL(), url);
    else if (this._node)
      hrefUrl = this._node.resolveURL(url);
    container.appendChild(Components.Linkifier.linkifyURL(hrefUrl || url, {text: url, preventClick: true}));
    container.createTextChild(')');
    return container;
  }
};

/**
 * @implements {UI.ToolbarItem.Provider}
 */
Elements.StylesSidebarPane.ButtonProvider = class {
  constructor() {
    this._button = new UI.ToolbarButton(Common.UIString('New Style Rule'), 'largeicon-add');
    this._button.addEventListener(UI.ToolbarButton.Events.Click, this._clicked, this);
    var longclickTriangle = UI.Icon.create('largeicon-longclick-triangle', 'long-click-glyph');
    this._button.element.appendChild(longclickTriangle);

    new UI.LongClickController(this._button.element, this._longClicked.bind(this));
    UI.context.addFlavorChangeListener(SDK.DOMNode, onNodeChanged.bind(this));
    onNodeChanged.call(this);

    /**
     * @this {Elements.StylesSidebarPane.ButtonProvider}
     */
    function onNodeChanged() {
      var node = UI.context.flavor(SDK.DOMNode);
      node = node ? node.enclosingElementOrSelf() : null;
      this._button.setEnabled(!!node);
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _clicked(event) {
    Elements.StylesSidebarPane._instance._createNewRuleInViaInspectorStyleSheet();
  }

  /**
   * @param {!Event} e
   */
  _longClicked(e) {
    Elements.StylesSidebarPane._instance._onAddButtonLongClick(e);
  }

  /**
   * @override
   * @return {!UI.ToolbarItem}
   */
  item() {
    return this._button;
  }
};