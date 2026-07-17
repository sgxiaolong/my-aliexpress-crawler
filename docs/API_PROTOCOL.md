# 5173 与爬虫服务协议

5173 默认请求 `http://127.0.0.1:5174/api/*`。创建采集任务仅写 5173 本地工作流；随后由手动操作或 workflow runner 调用爬虫。

```text
5173 创建任务 → storage/products/<id>/workflow.json
5173 发起采集 → 5174 /api/scrape
5174 返回数据 → 5173 写 item.json / 更新 scrape 状态
```

采集失败会由 5173 记录为阶段错误，不会把商品 JSON 写到爬虫项目。服务因登录、验证码或风控无法抓取时，应先在 5174 的独立 Chrome Profile 内恢复会话后重试。

Cookie 更新接口仍是 5174 的兼容能力，但控制台不转发它，也不保存 Cookie 字符串。新的集成不应依赖浏览器请求中临时携带 Cookie。
