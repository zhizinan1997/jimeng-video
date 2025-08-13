原项目似乎已经停止更新。您可以选择直接从我（或您自己 Fork 后）的库内拉取代码，进行本地构建镜像并安装。
https://github.com/zhizinan1997/jimeng-free-api
以下是详细的操作步骤：

### 代码操作指南

1.  **拉取代码库**
    ```bash
    git clone https://github.com/zhizinan1997/jimeng-video.git
    ```

2.  **进入项目文件夹**
    ```bash
    cd jimeng-video
    ```

3.  **构建 Docker 镜像**
    ```bash
    docker build -t jimeng-video:latest .
    ```
    *   此命令将根据项目中的 `Dockerfile` 构建本地镜像。

4.  **启动 Docker 容器**
    ```bash
    docker run -it -d --init --name jimeng-free-api -p 8001:8000 -e TZ=Asia/Shanghai jimeng-video:latest
    ```
    *   `-p 8001:8000`: 将宿主机的 `8001` 端口映射到容器内部的 `8000` 端口。您可以根据需要修改 `8001`。
    *   `-e TZ=Asia/Shanghai`: 设置容器内的时区为上海，确保日志和时间戳正确。

### API 使用说明

*   **模型名称**: 在您的chat格式 API 请求中，请指定使用视频模型作为模型名称，名称参见下图。
*   **其他使用方法**: API 调用方式和参数与原项目保持不变。服务将通过您映射的宿主机端口（例如 `http://localhost:8001`）对外提供。
<img width="1013" height="895" alt="image" src="https://github.com/user-attachments/assets/5c86b17f-b55e-4ac5-bc02-68bb3262373d" />
<img width="948" height="769" alt="image" src="https://github.com/user-attachments/assets/f5f55f9d-f7aa-4a7d-99ca-16958d9a2faa" />


