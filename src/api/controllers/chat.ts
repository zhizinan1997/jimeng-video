import _ from "lodash";
import { PassThrough } from "stream";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import { generateImages, DEFAULT_MODEL } from "./images.ts";
import { generateVideo, DEFAULT_MODEL as DEFAULT_VIDEO_MODEL } from "./videos.ts";

// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;

/**
 * 解析模型
 *
 * @param model 模型名称
 * @returns 模型信息
 */
function parseModel(model: string) {
  const [_model, size] = model.split(":");
  const [_, width, height] = /(\d+)[\W\w](\d+)/.exec(size) ?? [];
  return {
    model: _model,
    width: size ? Math.ceil(parseInt(width) / 2) * 2 : 1024,
    height: size ? Math.ceil(parseInt(height) / 2) * 2 : 1024,
  };
}

/**
 * 检测是否为视频生成请求
 * 
 * @param model 模型名称
 * @returns 是否为视频生成请求
 */
function isVideoModel(model: string) {
  return model.startsWith("jimeng-video");
}

/**
 * 同步对话补全
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param assistantId 智能体ID，默认使用jimeng原版
 * @param retryCount 重试次数
 */
export async function createCompletion(
  messages: any[],
  refreshToken: string,
  _model = DEFAULT_MODEL,
  retryCount = 0
) {
  return (async () => {
    if (messages.length === 0)
      throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "消息不能为空");

    const { model, width, height } = parseModel(_model);
    logger.info(messages);

    // 检查是否为视频生成请求
    if (isVideoModel(_model)) {
      // 视频生成
      const videoUrl = await generateVideo(
        _model,
        messages[messages.length - 1].content,
        {
          width,
          height,
          resolution: "720p", // 默认分辨率
        },
        refreshToken
      );

      return {
        id: util.uuid(),
        model: _model,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: `![video](${videoUrl})\n`,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        created: util.unixTimestamp(),
      };
    } else {
      // 图像生成
      const imageUrls = await generateImages(
        model,
        messages[messages.length - 1].content,
        {
          width,
          height,
        },
        refreshToken
      );

      return {
        id: util.uuid(),
        model: _model || model,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: imageUrls.reduce(
                (acc, url, i) => acc + `![image_${i}](${url})\n`,
                ""
              ),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        created: util.unixTimestamp(),
      };
    }
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletion(messages, refreshToken, _model, retryCount + 1);
      })();
    }
    throw err;
  });
}

/**
 * 流式对话补全
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param assistantId 智能体ID，默认使用jimeng原版
 * @param retryCount 重试次数
 */
export async function createCompletionStream(
  messages: any[],
  refreshToken: string,
  _model = DEFAULT_MODEL,
  retryCount = 0
) {
  return (async () => {
    const { model, width, height } = parseModel(_model);
    logger.info(messages);

    const stream = new PassThrough();

    if (messages.length === 0) {
      logger.warn("消息为空，返回空流");
      stream.end("data: [DONE]\n\n");
      return stream;
    }

    // 检查是否为视频生成请求
    if (isVideoModel(_model)) {
      // 视频生成
      stream.write(
        "data: " +
          JSON.stringify({
            id: util.uuid(),
            model: _model,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "🎬 视频生成中，请稍候..." },
                finish_reason: null,
              },
            ],
          }) +
          "\n\n"
      );

      generateVideo(
        _model,
        messages[messages.length - 1].content,
        { width, height, resolution: "720p" },
        refreshToken
      )
        .then((videoUrl) => {
          stream.write(
            "data: " +
              JSON.stringify({
                id: util.uuid(),
                model: _model,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 1,
                    delta: {
                      role: "assistant",
                      content: `![video](${videoUrl})\n`,
                    },
                    finish_reason: null,
                  },
                ],
              }) +
              "\n\n"
          );
          
          stream.write(
            "data: " +
              JSON.stringify({
                id: util.uuid(),
                model: _model,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 2,
                    delta: {
                      role: "assistant",
                      content: "视频生成完成！",
                    },
                    finish_reason: "stop",
                  },
                ],
              }) +
              "\n\n"
          );
          stream.end("data: [DONE]\n\n");
        })
        .catch((err) => {
          stream.write(
            "data: " +
              JSON.stringify({
                id: util.uuid(),
                model: _model,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 1,
                    delta: {
                      role: "assistant",
                      content: `生成视频失败: ${err.message}`,
                    },
                    finish_reason: "stop",
                  },
                ],
              }) +
              "\n\n"
          );
          stream.end("data: [DONE]\n\n");
        });
    } else {
      // 图像生成
      stream.write(
        "data: " +
          JSON.stringify({
            id: util.uuid(),
            model: _model || model,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "🎨 图像生成中，请稍候..." },
                finish_reason: null,
              },
            ],
          }) +
          "\n\n"
      );

      generateImages(
        model,
        messages[messages.length - 1].content,
        { width, height },
        refreshToken
      )
        .then((imageUrls) => {
          for (let i = 0; i < imageUrls.length; i++) {
            const url = imageUrls[i];
            stream.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  model: _model || model,
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: i + 1,
                      delta: {
                        role: "assistant",
                        content: `![image_${i}](${url})\n`,
                      },
                      finish_reason: i < imageUrls.length - 1 ? null : "stop",
                    },
                  ],
                }) +
                "\n\n"
            );
          }
          stream.write(
            "data: " +
              JSON.stringify({
                id: util.uuid(),
                model: _model || model,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: imageUrls.length + 1,
                    delta: {
                      role: "assistant",
                      content: "图像生成完成！",
                    },
                    finish_reason: "stop",
                  },
                ],
              }) +
              "\n\n"
          );
          stream.end("data: [DONE]\n\n");
        })
        .catch((err) => {
          stream.write(
            "data: " +
              JSON.stringify({
                id: util.uuid(),
                model: _model || model,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 1,
                    delta: {
                      role: "assistant",
                      content: `生成图片失败: ${err.message}`,
                    },
                    finish_reason: "stop",
                  },
                ],
              }) +
              "\n\n"
          );
          stream.end("data: [DONE]\n\n");
        });
    }
    return stream;
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletionStream(
          messages,
          refreshToken,
          _model,
          retryCount + 1
        );
      })();
    }
    throw err;
  });
}
