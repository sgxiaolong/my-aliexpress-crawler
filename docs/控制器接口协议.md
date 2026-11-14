# 15173 与爬虫服务协议

15173 默认请求 `http://127.0.0.1:15174/api/*`。创建采集任务仅写 15173 本地工作流；随后由手动操作或 workflow runner 调用爬虫。

```text
15173 创建任务 → storage/products/<id>/workflow.json
15173 发起采集 → 15174 /api/scrape
15174 返回数据 → 15173 写 item.json / 更新 scrape 状态
```

采集失败会由 15173 记录为阶段错误，不会把商品 JSON 写到爬虫项目。服务因登录、验证码或风控无法抓取时，应先在 15174 的独立 Chrome Profile 内恢复会话后重试。

15174 不提供 Cookie 字符串更新接口，控制台也不保存 Cookie 字符串。登录态只由采集 Chrome Profile 管理。
