import _ from "lodash";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, uploadFile } from "./core.ts";
import logger from "@/lib/logger.ts";

const DEFAULT_ASSISTANT_ID = "513695";
export const DEFAULT_MODEL = "jimeng-video-3.0";
const DRAFT_VERSION = "3.2.8";
const MODEL_MAP = {
  "jimeng-video-3.0-pro": "dreamina_ic_generate_video_model_vgfm_3.0_pro",
  "jimeng-video-3.0": "dreamina_ic_generate_video_model_vgfm_3.0",
  "jimeng-video-2.0": "dreamina_ic_generate_video_model_vgfm_lite",
  "jimeng-video-2.0-pro": "dreamina_ic_generate_video_model_vgfm1.0"
};

export function getModel(model: string) {
  return MODEL_MAP[model] || MODEL_MAP[DEFAULT_MODEL];
}

/**
 * 生成视频
 * 
 * @param _model 模型名称
 * @param prompt 提示词
 * @param options 选项
 * @param refreshToken 刷新令牌
 * @returns 视频URL
 */
export async function generateVideo(
  _model: string,
  prompt: string,
  {
    width = 1024,
    height = 1024,
    resolution = "720p",
    filePaths = [],
  }: {
    width?: number;
    height?: number;
    resolution?: string;
    filePaths?: string[];
  },
  refreshToken: string
) {
  const model = getModel(_model);
  logger.info(`使用模型: ${_model} 映射模型: ${model} ${width}x${height} 分辨率: ${resolution}`);

  // 检查积分
  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0)
    await receiveCredit(refreshToken);

  // 处理首帧和尾帧图片
  let first_frame_image = undefined;
  let end_frame_image = undefined;
  
  if (filePaths && filePaths.length > 0) {
    let uploadIDs: string[] = [];
    for (const filePath of filePaths) {
      if (!filePath) continue;
      
      try {
        const uploadResult = await uploadFile(refreshToken, filePath);
        if (uploadResult && uploadResult.image_uri) {
          uploadIDs.push(uploadResult.image_uri);
        }
      } catch (error) {
        logger.error(`上传图片失败: ${error.message}`);
      }
    }
    
    if (uploadIDs[0]) {
      first_frame_image = {
        format: "",
        height: height,
        id: util.uuid(),
        image_uri: uploadIDs[0],
        name: "",
        platform_type: 1,
        source_from: "upload",
        type: "image",
        uri: uploadIDs[0],
        width: width,
      };
    }
    
    if (uploadIDs[1]) {
      end_frame_image = {
        format: "",
        height: height,
        id: util.uuid(),
        image_uri: uploadIDs[1],
        name: "",
        platform_type: 1,
        source_from: "upload",
        type: "image",
        uri: uploadIDs[1],
        width: width,
      };
    }
  }

  const componentId = util.uuid();
  const metricsExtra = JSON.stringify({
    "enterFrom": "click",
    "isDefaultSeed": 1,
    "promptSource": "custom",
    "isRegenerate": false,
    "originSubmitId": util.uuid(),
  });
  
  // 构建请求参数
  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
        aigc_features: "app_lip_sync",
        web_version: "6.6.0",
        da_version: DRAFT_VERSION,
      },
      data: {
        "extend": {
          "root_model": end_frame_image ? MODEL_MAP['jimeng-video-3.0'] : model,
          "m_video_commerce_info": {
            benefit_type: "basic_video_operation_vgfm_v_three",
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          },
          "m_video_commerce_info_list": [{
            benefit_type: "basic_video_operation_vgfm_v_three",
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          }]
        },
        "submit_id": util.uuid(),
        "metrics_extra": metricsExtra,
        "draft_content": JSON.stringify({
          "type": "draft",
          "id": util.uuid(),
          "min_version": "3.0.5",
          "is_from_tsn": true,
          "version": DRAFT_VERSION,
          "main_component_id": componentId,
          "component_list": [{
            "type": "video_base_component",
            "id": componentId,
            "min_version": "1.0.0",
            "metadata": {
              "type": "",
              "id": util.uuid(),
              "created_platform": 3,
              "created_platform_version": "",
              "created_time_in_ms": Date.now(),
              "created_did": ""
            },
            "generate_type": "gen_video",
            "aigc_mode": "workbench",
            "abilities": {
              "type": "",
              "id": util.uuid(),
              "gen_video": {
                "id": util.uuid(),
                "type": "",
                "text_to_video_params": {
                  "type": "",
                  "id": util.uuid(),
                  "model_req_key": model,
                  "priority": 0,
                  "seed": Math.floor(Math.random() * 100000000) + 2500000000,
                  "video_aspect_ratio": "1:1",
                  "video_gen_inputs": [{
                    duration_ms: 5000,
                    first_frame_image: first_frame_image,
                    end_frame_image: end_frame_image,
                    fps: 24,
                    id: util.uuid(),
                    min_version: "3.0.5",
                    prompt: prompt,
                    resolution: resolution,
                    type: "",
                    video_mode: 2
                  }]
                },
                "video_task_extra": metricsExtra,
              }
            }
          }],
        }),
        http_common_info: {
          aid: Number(DEFAULT_ASSISTANT_ID),
        },
      },
    }
  );

  const historyId = aigc_data.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  // 轮询获取结果
  let status = 20, failCode, item_list = [];
  while (status === 20) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [historyId],
      },
    });

    if (!result.history_list || result.history_list.length === 0)
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "历史记录不存在");

    status = result.history_list[0].status;
    failCode = result.history_list[0].fail_code;
    item_list = result.history_list[0].item_list || [];

    if (status === 30) {
      if (failCode === 2038) {
        throw new APIException(EX.API_CONTENT_FILTERED, "内容被过滤");
      } else {
        throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `生成失败，错误码: ${failCode}`);
      }
    }
  }

  // 提取视频URL
  const videoUrl = item_list?.[0]?.video?.transcoded_video?.origin?.video_url;
  if (!videoUrl) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "未能获取视频URL");
  }

  return videoUrl;
}