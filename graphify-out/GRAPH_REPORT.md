# Graph Report - typescript  (2026-05-10)

## Corpus Check
- 180 files · ~1,539,501 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2041 nodes · 4868 edges · 59 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]

## God Nodes (most connected - your core abstractions)
1. `Component` - 231 edges
2. `Text` - 69 edges
3. `Insets` - 55 edges
4. `Aria` - 53 edges
5. `Button` - 47 edges
6. `Label` - 45 edges
7. `Table` - 42 edges
8. `ModelRecord` - 37 edges
9. `ThemeManager` - 35 edges
10. `HBox` - 32 edges

## Surprising Connections (you probably didn't know these)
- `x()` --calls--> `it()`  [INFERRED]
  src/resources/bluebird.core.min.js → src/resources/Base/script/fontawesome/js/fontawesome.min.js
- `constructor()` --calls--> `applyThemePadding()`  [EXTRACTED]
  src/typescript/Base/component/table/cell/renderer/CellRenderer.ts → Base/component/table/cell/renderer/CellRenderer.ts
- `constructor()` --calls--> `applyThemePadding()`  [EXTRACTED]
  src/typescript/Base/component/table/cell/editor/CellEditor.ts → Base/component/table/cell/editor/CellEditor.ts
- `c()` --calls--> `Nt()`  [INFERRED]
  src/resources/bluebird.core.min.js → src/resources/Base/script/fontawesome/js/fontawesome.min.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (58): BaseObject, ContextMenu, addListener(), addViewportListener(), addViewportResizeListener(), fireEvent(), init(), removeListener() (+50 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (32): Body, ButtonGroup, Panel, Button, FieldSet, Image, Legend, ProgressBar (+24 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (22): Insets, ThemeManager, themeToVars(), measureInputBaseline(), measureTextMetrics(), measureTextSize(), measureTextWidth(), remeasureInputBaseline() (+14 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (7): Component, flushPendingLayouts(), Text, MenuSeparator, TreeRow, FieldDecorator, applyRule()

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (84): apiObject(), _arrayWithHoles(), _arrayWithoutHoles(), asIcon(), asSymbol(), asyncCall(), attributesParser(), blankMeta() (+76 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (84): apiObject(), _arrayWithHoles(), _arrayWithoutHoles(), asIcon(), asSymbol(), asyncCall(), attributesParser(), blankMeta() (+76 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (47): Option, createRecord(), ensureIndex(), getField(), getFields(), getPrimaryKeyField(), hasField(), add() (+39 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (15): createClassRule(), createComponentRule(), createRule(), ensureKeyframes(), getClassRule(), getComponentRule(), getMainStyle(), getRule() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (1): Aria

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (16): addActionListener(), addComponent(), constructor(), getElement(), getSelectedIndex(), getSelectedValue(), getStyle(), removeComponent() (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (42): a(), ac(), al(), bc(), c(), cl(), dc(), dl() (+34 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (40): ae(), At(), B(), be(), Bt(), Ce(), ct(), d() (+32 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (1): Table

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (31): ifArguments(), ifArray(), ifBoolean(), ifElement(), ifFloat(), ifFunction(), ifInteger(), ifNumber() (+23 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (4): Cell, TimeCell, TimeEditor, TimeRenderer

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (14): AjaxStore, AjaxProxy, Body(), bufferClone(), consumed(), fetch(), fileReaderReady(), isDataView() (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.18
Nodes (24): _(), a(), b(), c(), d(), e(), f(), g() (+16 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (1): NumberSpinner

### Community 18 - "Community 18"
Cohesion: 0.1
Nodes (1): AutoCompleteField

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (2): Body, columnWidthsEqual()

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (1): Menu

### Community 21 - "Community 21"
Cohesion: 0.23
Nodes (1): Tree

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (2): Border, BorderLine

### Community 23 - "Community 23"
Cohesion: 0.16
Nodes (1): ComboBox

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (1): Accordion

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (1): Binding

### Community 26 - "Community 26"
Cohesion: 0.21
Nodes (1): Header

### Community 27 - "Community 27"
Cohesion: 0.2
Nodes (1): Grid

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (1): Window

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (1): MenuPanel

### Community 30 - "Community 30"
Cohesion: 0.24
Nodes (1): Dialog

### Community 31 - "Community 31"
Cohesion: 0.28
Nodes (9): a(), c(), e(), i(), n(), o(), s(), t() (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.2
Nodes (1): Slider

### Community 33 - "Community 33"
Cohesion: 0.23
Nodes (1): AutoCompleteDropdown

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (1): HeaderCell

### Community 35 - "Community 35"
Cohesion: 0.25
Nodes (1): DateField

### Community 36 - "Community 36"
Cohesion: 0.27
Nodes (1): MenuItem

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (1): TimeField

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (1): Checkbox

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (1): TextInput

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (1): TablePanel

### Community 41 - "Community 41"
Cohesion: 0.31
Nodes (1): MenuItem

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (1): Tooltip

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (1): Notification

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (1): Row

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (2): getThemeFontSize(), ProgressSpinner

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (1): SpinButton

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (1): AutoCompleteItem

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (1): PaginatingDemoProxy

### Community 49 - "Community 49"
Cohesion: 0.52
Nodes (1): AccordionPanel

### Community 50 - "Community 50"
Cohesion: 0.38
Nodes (1): Header

### Community 51 - "Community 51"
Cohesion: 0.38
Nodes (1): FooterRow

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (1): DateTimeEditor

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (1): DateEditor

### Community 54 - "Community 54"
Cohesion: 0.33
Nodes (2): DialogButtonRow, DialogTitleBar

### Community 55 - "Community 55"
Cohesion: 0.4
Nodes (1): AccordionHeader

### Community 56 - "Community 56"
Cohesion: 0.6
Nodes (3): defineIcons(), _defineProperty(), _objectSpread()

### Community 57 - "Community 57"
Cohesion: 0.6
Nodes (3): defineIcons(), _defineProperty(), _objectSpread()

### Community 58 - "Community 58"
Cohesion: 0.6
Nodes (3): defineIcons(), _defineProperty(), _objectSpread()

## Knowledge Gaps
- **Thin community `Community 8`** (53 nodes): `Aria`, `.applyToElement()`, `.constructor()`, `.getActiveDescendant()`, `.getAutoComplete()`, `.getColCount()`, `.getColIndex()`, `.getControls()`, `.getDisabled()`, `.getExpanded()`, `.getHasPopup()`, `.getHidden()`, `.getLabel()`, `.getLabelledBy()`, `.getLevel()`, `.getPosInSet()`, `.getPressed()`, `.getRole()`, `.getRowCount()`, `.getRowIndex()`, `.getSelected()`, `.getSetSize()`, `.getSort()`, `.getTabIndex()`, `.getValueMax()`, `.getValueMin()`, `.getValueNow()`, `.setActiveDescendant()`, `.setAttribute()`, `.setAutoComplete()`, `.setColCount()`, `.setColIndex()`, `.setControls()`, `.setDisabled()`, `.setExpanded()`, `.setHasPopup()`, `.setHidden()`, `.setLabel()`, `.setLabelledBy()`, `.setLevel()`, `.setPosInSet()`, `.setPressed()`, `.setRole()`, `.setRowCount()`, `.setRowIndex()`, `.setSelected()`, `.setSetSize()`, `.setSort()`, `.setTabIndex()`, `.setValueMax()`, `.setValueMin()`, `.setValueNow()`, `Aria.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (34 nodes): `Table`, `.addComponent()`, `.addRow()`, `.buildColumnConfigs()`, `.constructor()`, `.defaultColumnWidth()`, `.exportCSV()`, `.exportJSON()`, `.getBody()`, `.getColumns()`, `.getColumnWidths()`, `.getEffectiveHiddenSet()`, `.getExportColumns()`, `.getFooter()`, `.getHeader()`, `.getModel()`, `.getSelectedRecord()`, `.getSelectedRecords()`, `.getStore()`, `.initHiddenFromSpec()`, `.isBodyVisible()`, `.isFooterVisible()`, `.isHeaderVisible()`, `.onColumnResize()`, `.reject()`, `.removeSelectedRow()`, `.resetColumns()`, `.setColumnVisible()`, `.setColumnWidths()`, `.setExportMenuEnabled()`, `.setStore()`, `.showColumnMenu()`, `.sync()`, `.trimToTarget()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (25 nodes): `NumberSpinner`, `.addBindingListener()`, `.addChangeListener()`, `.applyValue()`, `.constructor()`, `.derivePrecision()`, `.formatValue()`, `.getBaseline()`, `.getMax()`, `.getMin()`, `.getPrecision()`, `.getStep()`, `.getValue()`, `.isEnabled()`, `.normalize()`, `.onBlur()`, `.onKeyDown()`, `.setEnabled()`, `.setMax()`, `.setMin()`, `.setPrecision()`, `.setStep()`, `.setValue()`, `._setValueSilent()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (25 nodes): `AutoCompleteField`, `.addBindingListener()`, `.addSelectListener()`, `.constructor()`, `.doLayout()`, `.getBaseline()`, `.getValue()`, `.matches()`, `.onBlur()`, `.onDropdownHidden()`, `.onFocus()`, `.onInput()`, `.onKeyDown()`, `.onSuggestionSelected()`, `.querySuggestions()`, `.setDebounceMs()`, `.setMatchMode()`, `.setMaxSuggestions()`, `.setMinChars()`, `.setStore()`, `.setSuggestions()`, `.setValue()`, `.showSuggestions()`, `.syncSizeFromTextField()`, `.updateActiveDescendant()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (24 nodes): `Body`, `.bindStore()`, `.clearRowPool()`, `.computeRowHeight()`, `.constructor()`, `.getSelectedRecord()`, `.getSelectedRecords()`, `.init()`, `.invalidateGeom()`, `.onKeyDown()`, `.onRowClick()`, `.renderWindow()`, `.scrollRecordIntoView()`, `.scrollToRecord()`, `.selectRecord()`, `.setColumnConfigs()`, `.setHiddenColumns()`, `.setStore()`, `.sortColumns()`, `.sortRows()`, `._updateActiveDescendant()`, `._updateFocusStyle()`, `.updateRowVisualState()`, `columnWidthsEqual()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (23 nodes): `Menu`, `.activateFocused()`, `.applyPersistentChrome()`, `.applyRebuildChrome()`, `.assertPersistentMode()`, `.assertRebuildMode()`, `.buildPersistentItems()`, `.close()`, `.constructor()`, `.containsTarget()`, `.dispose()`, `.focusItem()`, `.focusNext()`, `.focusPrev()`, `.getFocusedIndex()`, `.handleItemOpenSubmenu()`, `.hide()`, `.isItemSeparator()`, `.open()`, `.setExcludedElement()`, `.setFocusedIndex()`, `.setMenuWidth()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (22 nodes): `Tree`, `.addSelectionListener()`, `.constructor()`, `.doLayout()`, `._extendSelectionTo()`, `._fireSelectionListeners()`, `._flatten()`, `.getNodes()`, `.getSelectedNode()`, `.getSelectedNodes()`, `._handleClick()`, `.init()`, `._invalidateGeom()`, `._onKeyDown()`, `._onToggle()`, `._rangeSelect()`, `._renderWindow()`, `._scrollIntoView()`, `._selectAtIndex()`, `.setNodes()`, `._updateActiveDescendant()`, `._updateSelectionStyle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (21 nodes): `Border`, `.applyOnCSSRule()`, `.constructor()`, `.fromString()`, `.getBottom()`, `.getLeft()`, `.getRight()`, `.getTop()`, `.set()`, `BorderLine`, `.applyOnCSSRule()`, `.constructor()`, `.getColor()`, `.getPlacement()`, `.getStyle()`, `.getStyleString()`, `.getWidth()`, `.render()`, `.set()`, `Border.ts`, `BorderLine.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (21 nodes): `ComboBox`, `.addActionListener()`, `.addBindingListener()`, `.addItem()`, `.applyStyle()`, `.constructor()`, `.getBaseline()`, `.getElement()`, `.getItems()`, `.getSelectedIndex()`, `.getSelectedItem()`, `.getSelectedRecord()`, `.getStore()`, `.getValue()`, `.refreshFromStore()`, `.render()`, `.setItems()`, `.setSelectedIndex()`, `.setStore()`, `.setValue()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (19 nodes): `Accordion`, `.attach()`, `.closeSection()`, `.createSection()`, `.detach()`, `.doLayout()`, `.getAnimationDuration()`, `.getHeaderHeight()`, `.getMinSize()`, `.getPreferredSize()`, `.isSectionOpen()`, `.isSingleOpen()`, `.onHeaderClicked()`, `.onHeaderKeyDown()`, `.openSection()`, `.setAnimationDuration()`, `.setHeaderHeight()`, `.setOnSectionToggle()`, `.setSingleOpen()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (18 nodes): `Binding`, `.addChangeListener()`, `.addCommitListener()`, `.addRejectListener()`, `.addValidation()`, `.bind()`, `.clearValidation()`, `.commit()`, `.getRecord()`, `.getValidateOnChange()`, `.reject()`, `.removeValidation()`, `.setRecord()`, `.setValidateOnChange()`, `.unbind()`, `.validate()`, `._validateField()`, `._validateFieldIfLive()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (17 nodes): `Header`, `.addComponent()`, `.addRow()`, `.constructor()`, `.getColumns()`, `.getModel()`, `.handleSortClick()`, `.rebuildCells()`, `.setHeight()`, `.setHiddenColumns()`, `.setModel()`, `.setOnColumnContextMenu()`, `.setOnColumnResize()`, `.setWidth()`, `.sortColumns()`, `.syncSortIndicators()`, `.wireCell()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (16 nodes): `Grid.ts`, `Grid`, `.constructor()`, `.doLayout()`, `.getColRowCount()`, `.getColumns()`, `.getComponentSpacing()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.getRows()`, `.isStretching()`, `.setColumns()`, `.setComponentSpacing()`, `.setRows()`, `.setStretching()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (14 nodes): `Window`, `.bringToFront()`, `.constructor()`, `.doLayout()`, `.flushResize()`, `.onDrag()`, `.onExitAction()`, `.onMouseDown()`, `.onMouseUp()`, `.onResize()`, `.render()`, `.setHeaderText()`, `.setResizeFps()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (14 nodes): `MenuPanel`, `.activateFocused()`, `.close()`, `.constructor()`, `.containsTarget()`, `.dispose()`, `.focusItem()`, `.focusNext()`, `.focusPrev()`, `.getFocusedIndex()`, `.handleItemOpenSubmenu()`, `.open()`, `.setExcludedElement()`, `.setFocusedIndex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (13 nodes): `Dialog`, `.center()`, `.computeContentHeight()`, `.confirm()`, `.constructor()`, `.focusFirst()`, `.getContentComponent()`, `.getFocusable()`, `.hide()`, `.onKeyDown()`, `.onViewportResize()`, `.open()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (12 nodes): `Slider`, `.addActionListener()`, `.constructor()`, `.getMaxValue()`, `.getMinValue()`, `.getStep()`, `.getValue()`, `.render()`, `.setMaxValue()`, `.setMinValue()`, `.setStep()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (12 nodes): `AutoCompleteDropdown`, `.constructor()`, `.getHighlightedId()`, `.getHighlightedValue()`, `.hide()`, `.highlightNext()`, `.highlightPrev()`, `.isOpen()`, `.moveTo()`, `.selectHighlighted()`, `.show()`, `.updatePool()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (12 nodes): `HeaderCell`, `.constructor()`, `.init()`, `.onResizeDrag()`, `.onResizeDragStart()`, `.onResizeDragStop()`, `.onSortClick()`, `.setOnContextMenu()`, `.setOnResizeDrag()`, `.setOnSortClick()`, `.setSortState()`, `.setTooltip()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (11 nodes): `DateField`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.formatDate()`, `.getBaseline()`, `.getValue()`, `.onInput()`, `.render()`, `.setValue()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (11 nodes): `MenuItem`, `.activate()`, `.constructor()`, `.dispose()`, `.doLayout()`, `.getBaseline()`, `.getSubmenuConfig()`, `.hasSubmenu()`, `.isEnabled()`, `.isSeparator()`, `.setFocused()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (11 nodes): `TimeField`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.formatTime()`, `.getBaseline()`, `.getValue()`, `.onInput()`, `.render()`, `.setValue()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (10 nodes): `Checkbox`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.getValue()`, `.isSelected()`, `.onAction()`, `.render()`, `.setSelected()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (10 nodes): `TextInput`, `.applyStyle()`, `.constructor()`, `.getBaseline()`, `.getText()`, `.getTextAlign()`, `.render()`, `.select()`, `.setText()`, `.setTextAlign()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (10 nodes): `TablePanel`, `.constructor()`, `.exportCSV()`, `.exportJSON()`, `.getPaginationBar()`, `.getTable()`, `.getToolbar()`, `.refreshSyncButtons()`, `.setExportMenuEnabled()`, `.setPaginationBar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (10 nodes): `MenuItem`, `.activate()`, `.constructor()`, `.dispose()`, `.doLayout()`, `.getSubmenuConfig()`, `.hasSubmenu()`, `.isEnabled()`, `.isSeparator()`, `.setFocused()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (10 nodes): `Tooltip`, `._applyColors()`, `.attach()`, `.attachToElement()`, `.constructor()`, `.detach()`, `.doLayout()`, `.getInstance()`, `.hide()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (9 nodes): `Notification`, `.constructor()`, `.dismiss()`, `.doLayout()`, `.pauseTimer()`, `.restack()`, `.resumeTimer()`, `.show()`, `.startTimer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (9 nodes): `Row.ts`, `Row`, `.constructor()`, `.doLayout()`, `.getGap()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.setGap()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (9 nodes): `getThemeFontSize()`, `ProgressSpinner`, `.constructor()`, `.doLayout()`, `.getSpinnerSize()`, `.hideOverlay()`, `.isOverlay()`, `.setSpinnerSize()`, `.showOverlay()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (9 nodes): `SpinButton`, `.addTickListener()`, `.cancelRepeat()`, `.constructor()`, `.fireTicks()`, `.onMouseDown()`, `.onMouseUp()`, `.scheduleNext()`, `.updateSize()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (8 nodes): `AutoCompleteItem`, `.constructor()`, `.doLayout()`, `.getBaseline()`, `.getText()`, `.isHighlighted()`, `.setHighlighted()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (7 nodes): `PaginatingDemoProxy`, `.constructor()`, `.create()`, `.destroy()`, `.getLastTotalCount()`, `.read()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (7 nodes): `AccordionPanel`, `.buildAboutSection()`, `.buildInfoSection()`, `.buildListSection()`, `.buildPreferencesSection()`, `.constructor()`, `.labeledField()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (7 nodes): `Header`, `.applyThemePadding()`, `.constructor()`, `.getBaseline()`, `.getLabel()`, `.getText()`, `.updatePreferredSize()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (7 nodes): `FooterRow`, `.addComponent()`, `.addRow()`, `.constructor()`, `.getColumns()`, `.setHeight()`, `.setWidth()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (7 nodes): `DateTimeEditor`, `.applyStyle()`, `.constructor()`, `.getValue()`, `.isEmpty()`, `.setValue()`, `.toInputString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (7 nodes): `DateEditor`, `.applyStyle()`, `.constructor()`, `.getValue()`, `.isEmpty()`, `.setValue()`, `.toInputString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (6 nodes): `DialogButtonRow`, `.constructor()`, `.doLayout()`, `DialogTitleBar`, `.constructor()`, `.doLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (6 nodes): `AccordionHeader`, `.constructor()`, `.createStyles()`, `.init()`, `.isExpanded()`, `.setExpanded()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Component` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 6`, `Community 7`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `Aria` connect `Community 8` to `Community 2`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `AjaxProxy` connect `Community 15` to `Community 6`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._