# sales-report

## Self-test checklist
- 切换维度/Tab/筛选后刷新，状态保持
- 复制 URL 到新窗口，状态复现
- 表头排序有方向提示
- 表头筛选可清空
- 订单明细弹窗点击仍可用（含复制/搜索）
- 图表切换 Tab/维度后不变形（必要时 resizeAll）
- Finance Tab：AR/AP/PO KPI、图表、Top 列表有数据/无数据时均可正常展示
- BP 报告入口：bp.latest_path 存在时显示链接并可点击跳转
- 财务 Tab：切换维度后 AR/AP/净现金差同步更新
- 财务 Tab：刷新后 KPI/图表/表格状态保持（含累计切换/排序/筛选）
- 财务 Tab：复制 URL 到新窗口可复现当前状态
- 财务 Tab：窗口缩放后图表可正常 resize
- 财务 Tab：表头筛选清空按钮可恢复全量显示
- 财务 Tab：右上角“打开 BP 报告”可新开页面
- Finance v3：bank 图表净现金流/累计切换可复现
- Finance v3：inventory 图表渲染正常
- Finance v3：wc 其他应付提示逻辑触发正确
- Finance v3：po SKU 切换与状态复现
- Finance v3：BP 链接兜底（latest_path 缺失/失效时 fallback）
- Finance v3：切换维度仅影响 AR，其他模块保持不变
- Finance v3：bank/po 新表格筛选排序可复现
- Finance v3：图表 resize 后不变形
