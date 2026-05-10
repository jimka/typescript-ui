# Graph Report - typescript  (2026-05-10)

## Corpus Check
- 180 files · ~1,536,590 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2036 nodes · 4859 edges · 83 communities detected
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
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]

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
Cohesion: 0.03
Nodes (27): Insets, Panel, ThemeManager, themeToVars(), measureInputBaseline(), measureTextMetrics(), measureTextSize(), measureTextWidth() (+19 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (66): BaseObject, ButtonGroup, ContextMenu, addListener(), addViewportListener(), addViewportResizeListener(), fireEvent(), init() (+58 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (3): Component, flushPendingLayouts(), MenuSeparator

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (50): createRecord(), ensureIndex(), getField(), getFields(), getPrimaryKeyField(), hasField(), add(), applyView() (+42 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (84): apiObject(), _arrayWithHoles(), _arrayWithoutHoles(), asIcon(), asSymbol(), asyncCall(), attributesParser(), blankMeta() (+76 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (84): apiObject(), _arrayWithHoles(), _arrayWithoutHoles(), asIcon(), asSymbol(), asyncCall(), attributesParser(), blankMeta() (+76 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (1): Aria

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (42): a(), ac(), al(), bc(), c(), cl(), dc(), dl() (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (40): ae(), At(), B(), be(), Bt(), Ce(), ct(), d() (+32 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (4): Binding, Tooltip, FieldDecorator, applyRule()

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (1): Table

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (31): ifArguments(), ifArray(), ifBoolean(), ifElement(), ifFloat(), ifFunction(), ifInteger(), ifNumber() (+23 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (4): Cell, DateTimeCell, DateTimeEditor, DateTimeRenderer

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (13): addActionListener(), addComponent(), constructor(), getElement(), getSelectedIndex(), getSelectedValue(), getStyle(), removeComponent() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (14): AjaxStore, AjaxProxy, Body(), bufferClone(), consumed(), fetch(), fileReaderReady(), isDataView() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (24): _(), a(), b(), c(), d(), e(), f(), g() (+16 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (1): NumberSpinner

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (1): AutoCompleteField

### Community 18 - "Community 18"
Cohesion: 0.16
Nodes (2): Body, columnWidthsEqual()

### Community 19 - "Community 19"
Cohesion: 0.19
Nodes (1): Menu

### Community 20 - "Community 20"
Cohesion: 0.23
Nodes (1): Tree

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (1): ComboBox

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (1): Button

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (1): Accordion

### Community 24 - "Community 24"
Cohesion: 0.2
Nodes (1): Header

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (2): List, MultiSelectList

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (1): Tab

### Community 27 - "Community 27"
Cohesion: 0.22
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
Cohesion: 0.41
Nodes (10): createClassRule(), createComponentRule(), createRule(), ensureKeyframes(), getClassRule(), getComponentRule(), getMainStyle(), getRule() (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.2
Nodes (1): Slider

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (1): SplitGutter

### Community 35 - "Community 35"
Cohesion: 0.23
Nodes (1): AutoCompleteDropdown

### Community 36 - "Community 36"
Cohesion: 0.17
Nodes (1): HeaderCell

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (1): DateField

### Community 38 - "Community 38"
Cohesion: 0.27
Nodes (1): MenuItem

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (1): TimeField

### Community 40 - "Community 40"
Cohesion: 0.38
Nodes (1): ComplexUIPanel

### Community 41 - "Community 41"
Cohesion: 0.36
Nodes (1): BorderLine

### Community 42 - "Community 42"
Cohesion: 0.24
Nodes (1): Row

### Community 43 - "Community 43"
Cohesion: 0.24
Nodes (1): Column

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (1): Checkbox

### Community 45 - "Community 45"
Cohesion: 0.2
Nodes (1): WindowBorder

### Community 46 - "Community 46"
Cohesion: 0.2
Nodes (1): TextInput

### Community 47 - "Community 47"
Cohesion: 0.2
Nodes (1): TreeRow

### Community 48 - "Community 48"
Cohesion: 0.31
Nodes (1): MenuItem

### Community 49 - "Community 49"
Cohesion: 0.31
Nodes (1): Notification

### Community 50 - "Community 50"
Cohesion: 0.22
Nodes (1): Border

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (2): getThemeFontSize(), ProgressSpinner

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (1): SpinButton

### Community 53 - "Community 53"
Cohesion: 0.28
Nodes (1): ProgressBar

### Community 54 - "Community 54"
Cohesion: 0.36
Nodes (1): RovingTabIndex

### Community 55 - "Community 55"
Cohesion: 0.39
Nodes (1): Card

### Community 56 - "Community 56"
Cohesion: 0.32
Nodes (1): Split

### Community 57 - "Community 57"
Cohesion: 0.25
Nodes (1): AutoCompleteItem

### Community 58 - "Community 58"
Cohesion: 0.36
Nodes (1): Row

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (1): PaginatingDemoProxy

### Community 60 - "Community 60"
Cohesion: 0.52
Nodes (1): AccordionPanel

### Community 61 - "Community 61"
Cohesion: 0.38
Nodes (1): Table

### Community 62 - "Community 62"
Cohesion: 0.38
Nodes (1): Header

### Community 63 - "Community 63"
Cohesion: 0.33
Nodes (1): TablePanel

### Community 64 - "Community 64"
Cohesion: 0.38
Nodes (1): FooterRow

### Community 65 - "Community 65"
Cohesion: 0.33
Nodes (1): TimeEditor

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (1): DateEditor

### Community 67 - "Community 67"
Cohesion: 0.38
Nodes (1): Point

### Community 68 - "Community 68"
Cohesion: 0.53
Nodes (1): Benchmark

### Community 69 - "Community 69"
Cohesion: 0.33
Nodes (2): DialogButtonRow, DialogTitleBar

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (1): StringRenderer

### Community 71 - "Community 71"
Cohesion: 0.4
Nodes (1): AccordionHeader

### Community 72 - "Community 72"
Cohesion: 0.4
Nodes (1): MenuBar

### Community 73 - "Community 73"
Cohesion: 0.4
Nodes (1): BooleanEditor

### Community 74 - "Community 74"
Cohesion: 0.5
Nodes (1): Body

### Community 75 - "Community 75"
Cohesion: 0.4
Nodes (1): DialogBackdrop

### Community 76 - "Community 76"
Cohesion: 0.4
Nodes (1): MenuBarButton

### Community 77 - "Community 77"
Cohesion: 0.6
Nodes (3): defineIcons(), _defineProperty(), _objectSpread()

### Community 78 - "Community 78"
Cohesion: 0.6
Nodes (3): defineIcons(), _defineProperty(), _objectSpread()

### Community 79 - "Community 79"
Cohesion: 0.6
Nodes (3): defineIcons(), _defineProperty(), _objectSpread()

### Community 80 - "Community 80"
Cohesion: 0.67
Nodes (1): PaginationBar

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (1): DateRenderer

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): TabPanel

## Knowledge Gaps
- **Thin community `Community 6`** (53 nodes): `Aria`, `.applyToElement()`, `.constructor()`, `.getActiveDescendant()`, `.getAutoComplete()`, `.getColCount()`, `.getColIndex()`, `.getControls()`, `.getDisabled()`, `.getExpanded()`, `.getHasPopup()`, `.getHidden()`, `.getLabel()`, `.getLabelledBy()`, `.getLevel()`, `.getPosInSet()`, `.getPressed()`, `.getRole()`, `.getRowCount()`, `.getRowIndex()`, `.getSelected()`, `.getSetSize()`, `.getSort()`, `.getTabIndex()`, `.getValueMax()`, `.getValueMin()`, `.getValueNow()`, `.setActiveDescendant()`, `.setAttribute()`, `.setAutoComplete()`, `.setColCount()`, `.setColIndex()`, `.setControls()`, `.setDisabled()`, `.setExpanded()`, `.setHasPopup()`, `.setHidden()`, `.setLabel()`, `.setLabelledBy()`, `.setLevel()`, `.setPosInSet()`, `.setPressed()`, `.setRole()`, `.setRowCount()`, `.setRowIndex()`, `.setSelected()`, `.setSetSize()`, `.setSort()`, `.setTabIndex()`, `.setValueMax()`, `.setValueMin()`, `.setValueNow()`, `Aria.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (34 nodes): `Table`, `.addComponent()`, `.addRow()`, `.buildColumnConfigs()`, `.constructor()`, `.defaultColumnWidth()`, `.exportCSV()`, `.exportJSON()`, `.getBody()`, `.getColumns()`, `.getColumnWidths()`, `.getEffectiveHiddenSet()`, `.getExportColumns()`, `.getFooter()`, `.getHeader()`, `.getModel()`, `.getSelectedRecord()`, `.getSelectedRecords()`, `.getStore()`, `.initHiddenFromSpec()`, `.isBodyVisible()`, `.isFooterVisible()`, `.isHeaderVisible()`, `.onColumnResize()`, `.reject()`, `.removeSelectedRow()`, `.resetColumns()`, `.setColumnVisible()`, `.setColumnWidths()`, `.setExportMenuEnabled()`, `.setStore()`, `.showColumnMenu()`, `.sync()`, `.trimToTarget()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (25 nodes): `NumberSpinner`, `.addBindingListener()`, `.addChangeListener()`, `.applyValue()`, `.constructor()`, `.derivePrecision()`, `.formatValue()`, `.getBaseline()`, `.getMax()`, `.getMin()`, `.getPrecision()`, `.getStep()`, `.getValue()`, `.isEnabled()`, `.normalize()`, `.onBlur()`, `.onKeyDown()`, `.setEnabled()`, `.setMax()`, `.setMin()`, `.setPrecision()`, `.setStep()`, `.setValue()`, `._setValueSilent()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (25 nodes): `AutoCompleteField`, `.addBindingListener()`, `.addSelectListener()`, `.constructor()`, `.doLayout()`, `.getBaseline()`, `.getValue()`, `.matches()`, `.onBlur()`, `.onDropdownHidden()`, `.onFocus()`, `.onInput()`, `.onKeyDown()`, `.onSuggestionSelected()`, `.querySuggestions()`, `.setDebounceMs()`, `.setMatchMode()`, `.setMaxSuggestions()`, `.setMinChars()`, `.setStore()`, `.setSuggestions()`, `.setValue()`, `.showSuggestions()`, `.syncSizeFromTextField()`, `.updateActiveDescendant()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (24 nodes): `Body`, `.bindStore()`, `.clearRowPool()`, `.computeRowHeight()`, `.constructor()`, `.getSelectedRecord()`, `.getSelectedRecords()`, `.init()`, `.invalidateGeom()`, `.onKeyDown()`, `.onRowClick()`, `.renderWindow()`, `.scrollRecordIntoView()`, `.scrollToRecord()`, `.selectRecord()`, `.setColumnConfigs()`, `.setHiddenColumns()`, `.setStore()`, `.sortColumns()`, `.sortRows()`, `._updateActiveDescendant()`, `._updateFocusStyle()`, `.updateRowVisualState()`, `columnWidthsEqual()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (23 nodes): `Menu`, `.activateFocused()`, `.applyPersistentChrome()`, `.applyRebuildChrome()`, `.assertPersistentMode()`, `.assertRebuildMode()`, `.buildPersistentItems()`, `.close()`, `.constructor()`, `.containsTarget()`, `.dispose()`, `.focusItem()`, `.focusNext()`, `.focusPrev()`, `.getFocusedIndex()`, `.handleItemOpenSubmenu()`, `.hide()`, `.isItemSeparator()`, `.open()`, `.setExcludedElement()`, `.setFocusedIndex()`, `.setMenuWidth()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (22 nodes): `Tree`, `.addSelectionListener()`, `.constructor()`, `.doLayout()`, `._extendSelectionTo()`, `._fireSelectionListeners()`, `._flatten()`, `.getNodes()`, `.getSelectedNode()`, `.getSelectedNodes()`, `._handleClick()`, `.init()`, `._invalidateGeom()`, `._onKeyDown()`, `._onToggle()`, `._rangeSelect()`, `._renderWindow()`, `._scrollIntoView()`, `._selectAtIndex()`, `.setNodes()`, `._updateActiveDescendant()`, `._updateSelectionStyle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (21 nodes): `ComboBox`, `.addActionListener()`, `.addBindingListener()`, `.addItem()`, `.applyStyle()`, `.constructor()`, `.getBaseline()`, `.getElement()`, `.getItems()`, `.getSelectedIndex()`, `.getSelectedItem()`, `.getSelectedRecord()`, `.getStore()`, `.getValue()`, `.refreshFromStore()`, `.render()`, `.setItems()`, `.setSelectedIndex()`, `.setStore()`, `.setValue()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (20 nodes): `Button`, `.addActionListener()`, `.constructor()`, `.getBaseline()`, `.getLabel()`, `.getPressedBackgroundColor()`, `.getPressedBackgroundImage()`, `.getPressedBorder()`, `.getPressedBorderRadius()`, `.getPressedForegroundColor()`, `.getPressedShadow()`, `.getText()`, `.isEnabled()`, `.setEnabled()`, `.setPressedBackgroundColor()`, `.setPressedBackgroundImage()`, `.setPressedBorder()`, `.setPressedBorderRadius()`, `.setPressedForegroundColor()`, `.setPressedShadow()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (19 nodes): `Accordion`, `.attach()`, `.closeSection()`, `.createSection()`, `.detach()`, `.doLayout()`, `.getAnimationDuration()`, `.getHeaderHeight()`, `.getMinSize()`, `.getPreferredSize()`, `.isSectionOpen()`, `.isSingleOpen()`, `.onHeaderClicked()`, `.onHeaderKeyDown()`, `.openSection()`, `.setAnimationDuration()`, `.setHeaderHeight()`, `.setOnSectionToggle()`, `.setSingleOpen()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (17 nodes): `Header`, `.addComponent()`, `.addRow()`, `.constructor()`, `.getColumns()`, `.getModel()`, `.handleSortClick()`, `.rebuildCells()`, `.setHeight()`, `.setHiddenColumns()`, `.setModel()`, `.setOnColumnContextMenu()`, `.setOnColumnResize()`, `.setWidth()`, `.sortColumns()`, `.syncSortIndicators()`, `.wireCell()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (16 nodes): `List`, `.addActionListener()`, `.addItem()`, `.constructor()`, `.getBaseline()`, `.refreshFromStore()`, `.render()`, `.setItems()`, `.updateHeight()`, `MultiSelectList`, `.getSelectedRecords()`, `.getValues()`, `.render()`, `.setSelectedRecords()`, `.setValues()`, `MultiSelectList.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (15 nodes): `Tab`, `.attach()`, `.closeTab()`, `.constructor()`, `.createTab()`, `.detach()`, `.doLayout()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.getVisibleComponent()`, `.onTabPressed()`, `.onToolbarKeyDown()`, `.selectNextTab()`, `.setOnTabClose()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (15 nodes): `Grid`, `.constructor()`, `.doLayout()`, `.getColRowCount()`, `.getColumns()`, `.getComponentSpacing()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.getRows()`, `.isStretching()`, `.setColumns()`, `.setComponentSpacing()`, `.setRows()`, `.setStretching()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (14 nodes): `Window`, `.bringToFront()`, `.constructor()`, `.doLayout()`, `.flushResize()`, `.onDrag()`, `.onExitAction()`, `.onMouseDown()`, `.onMouseUp()`, `.onResize()`, `.render()`, `.setHeaderText()`, `.setResizeFps()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (14 nodes): `MenuPanel`, `.activateFocused()`, `.close()`, `.constructor()`, `.containsTarget()`, `.dispose()`, `.focusItem()`, `.focusNext()`, `.focusPrev()`, `.getFocusedIndex()`, `.handleItemOpenSubmenu()`, `.open()`, `.setExcludedElement()`, `.setFocusedIndex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (13 nodes): `Dialog`, `.center()`, `.computeContentHeight()`, `.confirm()`, `.constructor()`, `.focusFirst()`, `.getContentComponent()`, `.getFocusable()`, `.hide()`, `.onKeyDown()`, `.onViewportResize()`, `.open()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (12 nodes): `Slider`, `.addActionListener()`, `.constructor()`, `.getMaxValue()`, `.getMinValue()`, `.getStep()`, `.getValue()`, `.render()`, `.setMaxValue()`, `.setMinValue()`, `.setStep()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (12 nodes): `SplitGutter`, `.addDragListener()`, `.constructor()`, `.destroy()`, `.fireDragListeners()`, `.getDirection()`, `.onDrag()`, `.onDragStart()`, `.onDragStop()`, `.removeDragListener()`, `.render()`, `.setDirection()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (12 nodes): `AutoCompleteDropdown`, `.constructor()`, `.getHighlightedId()`, `.getHighlightedValue()`, `.hide()`, `.highlightNext()`, `.highlightPrev()`, `.isOpen()`, `.moveTo()`, `.selectHighlighted()`, `.show()`, `.updatePool()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (12 nodes): `HeaderCell`, `.constructor()`, `.init()`, `.onResizeDrag()`, `.onResizeDragStart()`, `.onResizeDragStop()`, `.onSortClick()`, `.setOnContextMenu()`, `.setOnResizeDrag()`, `.setOnSortClick()`, `.setSortState()`, `.setTooltip()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (11 nodes): `DateField`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.formatDate()`, `.getBaseline()`, `.getValue()`, `.onInput()`, `.render()`, `.setValue()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (11 nodes): `MenuItem`, `.activate()`, `.constructor()`, `.dispose()`, `.doLayout()`, `.getBaseline()`, `.getSubmenuConfig()`, `.hasSubmenu()`, `.isEnabled()`, `.isSeparator()`, `.setFocused()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (11 nodes): `TimeField`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.formatTime()`, `.getBaseline()`, `.getValue()`, `.onInput()`, `.render()`, `.setValue()`, `.updateHeight()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (10 nodes): `ComplexUIPanel`, `.buildPanel1()`, `.buildPanel2()`, `.buildPanel3()`, `.buildPanel4()`, `.buildPanel5()`, `.buildPanel6()`, `.buildPanel7()`, `.constructor()`, `.initLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (10 nodes): `BorderLine`, `.applyOnCSSRule()`, `.constructor()`, `.getColor()`, `.getPlacement()`, `.getStyle()`, `.getStyleString()`, `.getWidth()`, `.render()`, `.set()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (10 nodes): `Row`, `.constructor()`, `.doLayout()`, `.getGap()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.setGap()`, `Row.ts`, `RowPanel.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (10 nodes): `Column`, `.constructor()`, `.doLayout()`, `.getGap()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.isStretching()`, `.setGap()`, `.setStretching()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (10 nodes): `Checkbox`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.getValue()`, `.isSelected()`, `.onAction()`, `.render()`, `.setSelected()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (10 nodes): `WindowBorder`, `.addDragListener()`, `.constructor()`, `.fireDragListeners()`, `.getDirection()`, `.onDragStart()`, `.onDragStop()`, `.removeDragListener()`, `.render()`, `.setDirection()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (10 nodes): `TextInput`, `.applyStyle()`, `.constructor()`, `.getBaseline()`, `.getText()`, `.getTextAlign()`, `.render()`, `.select()`, `.setText()`, `.setTextAlign()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (10 nodes): `TreeRow`, `.constructor()`, `.getContentWidth()`, `.getDepth()`, `.getNode()`, `.getNodeLabel()`, `.getToggle()`, `.init()`, `.layoutChildren()`, `.setRowData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (10 nodes): `MenuItem`, `.activate()`, `.constructor()`, `.dispose()`, `.doLayout()`, `.getSubmenuConfig()`, `.hasSubmenu()`, `.isEnabled()`, `.isSeparator()`, `.setFocused()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `Notification`, `.constructor()`, `.dismiss()`, `.doLayout()`, `.pauseTimer()`, `.restack()`, `.resumeTimer()`, `.show()`, `.startTimer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (9 nodes): `Border`, `.applyOnCSSRule()`, `.constructor()`, `.fromString()`, `.getBottom()`, `.getLeft()`, `.getRight()`, `.getTop()`, `.set()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (9 nodes): `getThemeFontSize()`, `ProgressSpinner`, `.constructor()`, `.doLayout()`, `.getSpinnerSize()`, `.hideOverlay()`, `.isOverlay()`, `.setSpinnerSize()`, `.showOverlay()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (9 nodes): `SpinButton`, `.addTickListener()`, `.cancelRepeat()`, `.constructor()`, `.fireTicks()`, `.onMouseDown()`, `.onMouseUp()`, `.scheduleNext()`, `.updateSize()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (9 nodes): `ProgressBar`, `.applyIndeterminate()`, `.constructor()`, `.doLayout()`, `.getBaseline()`, `.getValue()`, `.isIndeterminate()`, `.setIndeterminate()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (8 nodes): `RovingTabIndex`, `.add()`, `.getActiveIndex()`, `.getItems()`, `.moveNext()`, `.movePrev()`, `.moveTo()`, `.remove()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (8 nodes): `Card`, `.doLayout()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.getVisibleComponent()`, `.getVisibleComponentId()`, `.setVisibleComponentId()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (8 nodes): `Split`, `.constructor()`, `.detach()`, `.doLayout()`, `.getDirection()`, `.onDrag()`, `.recalculateSizes()`, `.setDirection()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (8 nodes): `AutoCompleteItem`, `.constructor()`, `.doLayout()`, `.getBaseline()`, `.getText()`, `.isHighlighted()`, `.setHighlighted()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (8 nodes): `Row`, `.addColumn()`, `.addComponent()`, `.constructor()`, `.doLayout()`, `.getData()`, `.setData()`, `.updateVisualState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (7 nodes): `PaginatingDemoProxy`, `.constructor()`, `.create()`, `.destroy()`, `.getLastTotalCount()`, `.read()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (7 nodes): `AccordionPanel`, `.buildAboutSection()`, `.buildInfoSection()`, `.buildListSection()`, `.buildPreferencesSection()`, `.constructor()`, `.labeledField()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (7 nodes): `Table`, `.attach()`, `.clamp()`, `.constructor()`, `.doLayout()`, `.initializeWidths()`, `.rescaleWidths()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (7 nodes): `Header`, `.applyThemePadding()`, `.constructor()`, `.getBaseline()`, `.getLabel()`, `.getText()`, `.updatePreferredSize()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (7 nodes): `TablePanel`, `.constructor()`, `.getPaginationBar()`, `.getTable()`, `.getToolbar()`, `.refreshSyncButtons()`, `.setPaginationBar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (7 nodes): `FooterRow`, `.addComponent()`, `.addRow()`, `.constructor()`, `.getColumns()`, `.setHeight()`, `.setWidth()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (7 nodes): `TimeEditor`, `.applyStyle()`, `.constructor()`, `.getValue()`, `.isEmpty()`, `.setValue()`, `.toInputString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (7 nodes): `DateEditor`, `.applyStyle()`, `.constructor()`, `.getValue()`, `.isEmpty()`, `.setValue()`, `.toInputString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (7 nodes): `Point`, `.constructor()`, `.getX()`, `.getY()`, `.render()`, `Point.ts`, `Point.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (6 nodes): `Benchmark`, `.benchAll()`, `.benchComponentInit()`, `.benchTableScroll()`, `.benchThemeSwitch()`, `.buildPersonStore()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (6 nodes): `DialogButtonRow`, `.constructor()`, `.doLayout()`, `DialogTitleBar`, `.constructor()`, `.doLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (6 nodes): `StringRenderer`, `.constructor()`, `.getLabel()`, `.getText()`, `.getValue()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (6 nodes): `AccordionHeader`, `.constructor()`, `.createStyles()`, `.init()`, `.isExpanded()`, `.setExpanded()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (6 nodes): `MenuBar`, `.closeMenu()`, `.constructor()`, `.getOpenIndex()`, `.openMenu()`, `.setMenus()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (6 nodes): `BooleanEditor`, `.constructor()`, `.getValue()`, `.setOnChange()`, `.setValue()`, `.toggle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (5 nodes): `Body`, `.constructor()`, `.getElement()`, `.getInstance()`, `.init()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (5 nodes): `DialogBackdrop`, `.addClickListener()`, `.constructor()`, `.destroy()`, `.resize()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `MenuBarButton`, `.constructor()`, `.dispose()`, `.doLayout()`, `.setActive()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (4 nodes): `PaginationBar`, `.constructor()`, `.dispose()`, `.refresh()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (4 nodes): `DateRenderer`, `.constructor()`, `.getValue()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `TabPanel`, `.buildContent()`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Component` connect `Community 2` to `Community 0`, `Community 1`, `Community 6`, `Community 9`, `Community 13`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **Why does `Aria` connect `Community 6` to `Community 0`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `AjaxProxy` connect `Community 14` to `Community 3`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._