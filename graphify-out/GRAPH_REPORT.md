# Graph Report - src/typescript  (2026-05-03)

## Corpus Check
- 113 files · ~51,943 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 936 nodes · 1808 edges · 31 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_CSS Style Properties|CSS Style Properties]]
- [[_COMMUNITY_Component Core|Component Core]]
- [[_COMMUNITY_Table Cell System|Table Cell System]]
- [[_COMMUNITY_Body & DOM Root|Body & DOM Root]]
- [[_COMMUNITY_Base Object Hierarchy|Base Object Hierarchy]]
- [[_COMMUNITY_Table Column & Header|Table Column & Header]]
- [[_COMMUNITY_UI Widget Components|UI Widget Components]]
- [[_COMMUNITY_Split Layout & Window|Split Layout & Window]]
- [[_COMMUNITY_List Components|List Components]]
- [[_COMMUNITY_Text Component|Text Component]]
- [[_COMMUNITY_Type Utilities|Type Utilities]]
- [[_COMMUNITY_Table Data Rows|Table Data Rows]]
- [[_COMMUNITY_Data Store|Data Store]]
- [[_COMMUNITY_Number Cell & Renderer|Number Cell & Renderer]]
- [[_COMMUNITY_ComboBox|ComboBox]]
- [[_COMMUNITY_Table Header|Table Header]]
- [[_COMMUNITY_Button|Button]]
- [[_COMMUNITY_Table Body|Table Body]]
- [[_COMMUNITY_Window|Window]]
- [[_COMMUNITY_Slider|Slider]]
- [[_COMMUNITY_Demo Panels|Demo Panels]]
- [[_COMMUNITY_CSS Rule Builder|CSS Rule Builder]]
- [[_COMMUNITY_Border Line|Border Line]]
- [[_COMMUNITY_HBox Layout|HBox Layout]]
- [[_COMMUNITY_VBox Layout|VBox Layout]]
- [[_COMMUNITY_Checkbox|Checkbox]]
- [[_COMMUNITY_Border Model|Border Model]]
- [[_COMMUNITY_Text Input|Text Input]]
- [[_COMMUNITY_Tooltip|Tooltip]]
- [[_COMMUNITY_Radio Button|Radio Button]]
- [[_COMMUNITY_Image Component|Image Component]]

## God Nodes (most connected - your core abstractions)
1. `Component` - 140 edges
2. `Text` - 35 edges
3. `Table` - 30 edges
4. `Insets` - 25 edges
5. `Button` - 24 edges
6. `ModelRecord` - 22 edges
7. `ComboBox` - 22 edges
8. `Header` - 18 edges
9. `Cell` - 18 edges
10. `Label` - 17 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "CSS Style Properties"
Cohesion: 0.03
Nodes (21): Insets, ThemeManager, themeToVars(), calculateScrollBarWidth(), generateUUID(), getScrollBarWidth(), isInteger(), DefaultCell (+13 more)

### Community 1 - "Component Core"
Cohesion: 0.04
Nodes (1): Component

### Community 2 - "Table Cell System"
Cohesion: 0.04
Nodes (17): Border, FontAwesomeIcon, Header, WindowHeader, Absolute, Border, Card, Fit (+9 more)

### Community 3 - "Body & DOM Root"
Cohesion: 0.05
Nodes (13): ContextMenu, FieldSet, Image, MemoryStore, Model, Store, HBox, VBox (+5 more)

### Community 4 - "Base Object Hierarchy"
Cohesion: 0.05
Nodes (27): Option, createRecord(), ensureIndex(), getField(), getFields(), getPrimaryKeyField(), hasField(), add() (+19 more)

### Community 5 - "Table Column & Header"
Cohesion: 0.05
Nodes (9): ButtonGroup, RadioButton, ToggleButton, Column, Row, Tab, ColumnPanel, LayoutTestPanel (+1 more)

### Community 6 - "UI Widget Components"
Cohesion: 0.04
Nodes (6): NumberCell, Label, Legend, Text, NumberEditor, NumberRenderer

### Community 7 - "Split Layout & Window"
Cohesion: 0.05
Nodes (5): List, Slider, SplitGutter, Split, SplitPanel

### Community 8 - "List Components"
Cohesion: 0.1
Nodes (4): BooleanCell, Cell, Checkbox, BooleanEditor

### Community 9 - "Text Component"
Cohesion: 0.08
Nodes (11): constructor(), getElement(), getSelectedIndex(), getSelectedValue(), setSelectedIndex(), setStyle(), BulletedList, ListItem (+3 more)

### Community 10 - "Type Utilities"
Cohesion: 0.13
Nodes (30): ifArguments(), ifArray(), ifBoolean(), ifElement(), ifFloat(), ifFunction(), ifInteger(), ifNumber() (+22 more)

### Community 11 - "Table Data Rows"
Cohesion: 0.11
Nodes (1): Table

### Community 12 - "Data Store"
Cohesion: 0.19
Nodes (1): ComboBox

### Community 13 - "Number Cell & Renderer"
Cohesion: 0.2
Nodes (1): Header

### Community 14 - "ComboBox"
Cohesion: 0.16
Nodes (1): Button

### Community 15 - "Table Header"
Cohesion: 0.18
Nodes (1): Body

### Community 16 - "Button"
Cohesion: 0.18
Nodes (2): Grid, GridPanel

### Community 17 - "Table Body"
Cohesion: 0.18
Nodes (1): Window

### Community 18 - "Window"
Cohesion: 0.22
Nodes (2): BaseObject, Point

### Community 19 - "Slider"
Cohesion: 0.18
Nodes (1): HeaderCell

### Community 20 - "Demo Panels"
Cohesion: 0.36
Nodes (8): createClassRule(), createComponentRule(), createRule(), getClassRule(), getComponentRule(), getMainStyle(), getRule(), getStyle()

### Community 21 - "CSS Rule Builder"
Cohesion: 0.36
Nodes (1): BorderLine

### Community 22 - "Border Line"
Cohesion: 0.22
Nodes (1): Binding

### Community 23 - "HBox Layout"
Cohesion: 0.2
Nodes (1): WindowBorder

### Community 24 - "VBox Layout"
Cohesion: 0.25
Nodes (1): TextField

### Community 25 - "Checkbox"
Cohesion: 0.22
Nodes (1): TextInput

### Community 26 - "Border Model"
Cohesion: 0.36
Nodes (1): Row

### Community 27 - "Text Input"
Cohesion: 0.43
Nodes (1): Tooltip

### Community 28 - "Tooltip"
Cohesion: 0.38
Nodes (1): Table

### Community 29 - "Radio Button"
Cohesion: 0.38
Nodes (1): FooterRow

### Community 30 - "Image Component"
Cohesion: 0.5
Nodes (1): Body

## Knowledge Gaps
- **Thin community `Component Core`** (98 nodes): `Component`, `.addComponent()`, `.applyStyle()`, `.commitCSSRule()`, `.commitElementStyle()`, `.constructor()`, `.delAttribute()`, `.delLayoutConstraints()`, `.destructor()`, `.doChildrenComponentLayouts()`, `.doLayout()`, `.focus()`, `.getAttribute()`, `.getAutoCommitStyle()`, `.getBackgroundColor()`, `.getBackgroundImage()`, `.getBorder()`, `.getBorderRadius()`, `.getBorderSize()`, `.getColorScheme()`, `.getComponents()`, `.getCSSRule()`, `.getCursor()`, `.getElement()`, `.getElementAttribute()`, `.getForegroundColor()`, `.getHeight()`, `.getInnerSize()`, `.getInsets()`, `.getLayoutConstraints()`, `.getLayoutManager()`, `.getMaxSize()`, `.getMinSize()`, `.getOverflow()`, `.getPadding()`, `.getPerimiterSize()`, `.getPosition()`, `.getPreferredSize()`, `.getShadow()`, `.getSize()`, `.getTag()`, `.getVerticalAlign()`, `.getWidth()`, `.getX()`, `.getY()`, `.hasElementAttribute()`, `.init()`, `.isLayoutPaused()`, `.isVisible()`, `.pauseLayout()`, `.removeAllComponents()`, `.removeComponent()`, `.removeElement()`, `.removeElementAttribute()`, `.render()`, `.resumeLayout()`, `.setAppearance()`, `.setAttribute()`, `.setAutoCommitStyle()`, `.setBackgroundColor()`, `.setBackgroundImage()`, `.setBorder()`, `.setBorderImage()`, `.setBorderRadius()`, `.setColorScheme()`, `.setCursor()`, `.setDisplayed()`, `.setElementAttribute()`, `.setElementCSSRule()`, `.setElementCSSRules()`, `.setElementStyle()`, `.setElementStyles()`, `.setForegroundColor()`, `.setHeight()`, `.setId()`, `.setInsets()`, `.setLayoutConstraints()`, `.setLayoutManager()`, `.setMaxSize()`, `.setMinSize()`, `.setOutline()`, `.setOverflow()`, `.setPadding()`, `.setPointerEvents()`, `.setPosition()`, `.setPreferredSize()`, `.setShadow()`, `.setSize()`, `.setTransform()`, `.setVerticalAlign()`, `.setVisible()`, `.setWidth()`, `.setX()`, `.setY()`, `.setZIndex()`, `.sortComponents()`, `.sync()`, `.unfocus()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Table Data Rows`** (27 nodes): `Table`, `.addComponent()`, `.addRow()`, `.constructor()`, `.defaultColumnWidth()`, `.getBody()`, `.getColumns()`, `.getColumnWidths()`, `.getEffectiveHiddenSet()`, `.getFooter()`, `.getHeader()`, `.getModel()`, `.getSelectedRecord()`, `.getSelectedRecords()`, `.getStore()`, `.initHiddenFromSpec()`, `.isBodyVisible()`, `.isFooterVisible()`, `.isHeaderVisible()`, `.onColumnResize()`, `.removeSelectedRow()`, `.setColumnVisible()`, `.setColumnWidths()`, `.setStore()`, `.showColumnMenu()`, `.sync()`, `.trimToTarget()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Data Store`** (18 nodes): `ComboBox`, `.addActionListener()`, `.addBindingListener()`, `.addItem()`, `.constructor()`, `.getElement()`, `.getItems()`, `.getSelectedIndex()`, `.getSelectedItem()`, `.getSelectedRecord()`, `.getStore()`, `.getValue()`, `.refreshFromStore()`, `.render()`, `.setItems()`, `.setSelectedIndex()`, `.setStore()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Number Cell & Renderer`** (17 nodes): `Header`, `.addComponent()`, `.addRow()`, `.constructor()`, `.getColumns()`, `.getModel()`, `.handleSortClick()`, `.rebuildCells()`, `.setHeight()`, `.setHiddenColumns()`, `.setModel()`, `.setOnColumnContextMenu()`, `.setOnColumnResize()`, `.setWidth()`, `.sortColumns()`, `.syncSortIndicators()`, `.wireCell()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ComboBox`** (16 nodes): `Button`, `.addActionListener()`, `.constructor()`, `.getLabel()`, `.getPressedBackgroundColor()`, `.getPressedBackgroundImage()`, `.getPressedBorder()`, `.getPressedBorderRadius()`, `.getPressedForegroundColor()`, `.getPressedShadow()`, `.setPressedBackgroundColor()`, `.setPressedBackgroundImage()`, `.setPressedBorder()`, `.setPressedBorderRadius()`, `.setPressedForegroundColor()`, `.setPressedShadow()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Table Header`** (16 nodes): `Body`, `.bindStore()`, `.clearRowPool()`, `.constructor()`, `.getSelectedRecord()`, `.getSelectedRecords()`, `.init()`, `.onRowClick()`, `.renderWindow()`, `.scrollToRecord()`, `.selectRecord()`, `.setHiddenColumns()`, `.setStore()`, `.sortColumns()`, `.sortRows()`, `.updateRowVisualState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Button`** (15 nodes): `Grid.ts`, `GridPanel.ts`, `Grid`, `.constructor()`, `.doLayout()`, `.getColRowCount()`, `.getColumns()`, `.getMaxSize()`, `.getMinSize()`, `.getPreferredSize()`, `.getRows()`, `.setColumns()`, `.setRows()`, `GridPanel`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Table Body`** (13 nodes): `Window`, `.constructor()`, `.doLayout()`, `.flushResize()`, `.onDrag()`, `.onExitAction()`, `.onMouseDown()`, `.onMouseUp()`, `.onResize()`, `.render()`, `.setHeaderText()`, `.setResizeFps()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Window`** (11 nodes): `BaseObject`, `.constructor()`, `.getClassName()`, `.getId()`, `.setId()`, `Point`, `.constructor()`, `.getX()`, `.getY()`, `.render()`, `Point.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Slider`** (11 nodes): `HeaderCell`, `.constructor()`, `.init()`, `.onResizeDrag()`, `.onResizeDragStart()`, `.onResizeDragStop()`, `.onSortClick()`, `.setOnContextMenu()`, `.setOnResizeDrag()`, `.setOnSortClick()`, `.setSortState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `CSS Rule Builder`** (10 nodes): `BorderLine`, `.applyOnCSSRule()`, `.constructor()`, `.getColor()`, `.getPlacement()`, `.getStyle()`, `.getStyleString()`, `.getWidth()`, `.render()`, `.set()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Border Line`** (10 nodes): `Binding`, `.addChangeListener()`, `.addCommitListener()`, `.addRejectListener()`, `.bind()`, `.commit()`, `.getRecord()`, `.reject()`, `.setRecord()`, `.unbind()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `HBox Layout`** (10 nodes): `WindowBorder`, `.addDragListener()`, `.constructor()`, `.fireDragListeners()`, `.getDirection()`, `.onDragStart()`, `.onDragStop()`, `.removeDragListener()`, `.render()`, `.setDirection()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VBox Layout`** (9 nodes): `TextField`, `.addActionListener()`, `.addBindingListener()`, `.constructor()`, `.destructor()`, `.getValue()`, `.onInput()`, `.render()`, `.setValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Checkbox`** (9 nodes): `TextInput`, `.applyStyle()`, `.constructor()`, `.getText()`, `.getTextAlign()`, `.render()`, `.select()`, `.setText()`, `.setTextAlign()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Border Model`** (8 nodes): `Row`, `.addColumn()`, `.addComponent()`, `.constructor()`, `.doLayout()`, `.getData()`, `.setData()`, `.updateVisualState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Text Input`** (7 nodes): `Tooltip`, `.attach()`, `.constructor()`, `.doLayout()`, `.getInstance()`, `.hide()`, `.show()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tooltip`** (7 nodes): `Table`, `.attach()`, `.clamp()`, `.constructor()`, `.doLayout()`, `.initializeWidths()`, `.rescaleWidths()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Radio Button`** (7 nodes): `FooterRow`, `.addComponent()`, `.addRow()`, `.constructor()`, `.getColumns()`, `.setHeight()`, `.setWidth()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Image Component`** (5 nodes): `Body`, `.constructor()`, `.getElement()`, `.getInstance()`, `.init()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Should `CSS Style Properties` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Component Core` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Table Cell System` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Body & DOM Root` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Base Object Hierarchy` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Table Column & Header` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `UI Widget Components` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._