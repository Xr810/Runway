import { createHash } from "node:crypto";
import { validImageData } from "./ai-contract";

/** Pure preparation, cached per confirmation so SQL retries reuse the same bytes.
 * Publication belongs to uploadAttachment, including its no-clobber/replay rules. */
export function prepareAgentAttachments(
  draftId: string,
  sourceIds: string[],
  images: { id: string; name: string; dataUrl: string }[],
) {
  return [...new Set(sourceIds)].map((imageId) => {
    const image = images.find((item) => item.id === imageId);
    if (!image || !validImageData(image.dataUrl))
      throw Error("来源截图缺失，请重新发送截图后生成提案。");
    const mime = image.dataUrl.slice(5, image.dataUrl.indexOf(";"));
    const bytes = Buffer.from(image.dataUrl.split(",")[1], "base64");
    const name =
      image.name.replace(/\.[^.]+$/, "") +
      (mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".webp");
    return {
      id:
        "ag_" +
        createHash("sha256")
          .update(draftId + ":" + image.id)
          .digest("hex"),
      file: new File([bytes], name, { type: mime }),
    };
  });
}
