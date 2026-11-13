# 速卖通采集器项目协作

## 上游接口协议必须同步维护

速卖通上游协议统一维护在 [速卖通接口文档](../../Flask/docs/业务模块/速卖通接口/README.md)，本项目重点查看“商品详情与评价采集接口”。本服务的下游 HTTP API 文档仍位于 `docs/API_REFERENCE.md` 和 `docs/API_PROTOCOL.md`，两者不能替代上游协议文档。

新增、接入、修改或停用速卖通 API（含页面自动请求、响应监听、JSONP 解析、共享采集库、描述/评价资源），必须在同一批改动中同步统一索引及对应协议条目。记录方法/完整地址或接口名、认证和触发页面、请求字段路径/类型/发送条件/默认值/编码、响应嵌套字段/类型/含义、脱敏示例、失败/重试边界、源码调用入口、证据来源与核对日期；区分上游字段、本地转换字段和本地默认值。

浏览器自动生成而代码未固定的请求参数应标待抓包，页面 Query 参数不能冒充 API 请求 schema；发现新接口也要先登记已知信息和缺口。只更新代码注释、测试 fixture 或下游文档不算完成。禁止将真实 Cookie、Token、签名 URL、登录票据或买家身份写入文档；补文档默认离线核对，不启动抓取或导出 Cookie 的调试脚本。

## 跨项目接口协议

本项目消费 Flask CSP 查询类型（src/generated/flask.d.ts），并通过 contracts/openapi.json 向控制器提供采集/状态协议。上游动态商品字段保留开放结构，上游协议文档要求仍按本文件原有规则执行。

- 修改接口或调用字段前，先读本仓库子模块 [contract-tools/README.md](tools/contract-tools/README.md)。未初始化时运行 `git submodule update --init tools/contract-tools`；共享仓库为 `https://github.com/sgxiaolong/contract-tools`（私有）。
- 工具主工作副本在 `D:\SmtProject\contract-tools`；本仓库的子模块固定工具版本。从子模块运行生成器时会自动定位工作区，其他布局设置 `SMT_WORKSPACE_ROOT`，不依赖爬虫总工程下的旧工具目录。
- 在工具目录按 README 安装开发依赖后，执行 `npm run generate`、`npm run check`、`npm run typecheck`。命令面向完整跨项目工作区，生成文件写回调用方仓库；禁止手改生成文件，不自动迁移 HTTP 客户端。
- 工具更新先验证、提交并推送共享仓库，再让使用方固定到已发布的提交；不要在服务启动时自动拉取最新工具。是否提交业务仓库仍按用户授权执行。
- 这是开发工具；业务部署使用已生成类型，不需要安装生成器或重启服务来生成协议。类型检查不替代现有参数校验和受影响的定向测试。
