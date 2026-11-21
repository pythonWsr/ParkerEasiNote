# bare_repo fixture

本目录只是 fixture 的种子说明；真正的裸仓库由 `tests/conftest.py::bare_repo`
在 pytest 的 `tmp_path` 里现场创建（裸库 + 工作副本 + 1 个初始提交），
避免把二进制仓库对象提交进仓库历史。

`seed/` 下是初始化时复制到工作副本的文件。
