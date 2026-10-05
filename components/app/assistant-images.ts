import type { AssistantPicture } from "./assistant-types";

function fileData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function readAssistantPicture(file: File): Promise<AssistantPicture> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("支持 PNG、JPEG 和 WebP 截图，请先转换其他格式。");
  if (file.size > 8 * 1024 * 1024 || !file.size) throw Error("每张原图需小于 8 MB。");
  const original = await fileData(file);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 50000000) throw Error("图片尺寸过大，请裁剪后发送。");
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("浏览器无法处理图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    if (dataUrl.length > 1500000) dataUrl = canvas.toDataURL("image/jpeg", 0.66);
    if (dataUrl.length > 1500000) throw Error("截图内容过多，请裁剪成多张图片。");
    return { id: crypto.randomUUID(), name: file.name.slice(0, 180), original, dataUrl };
  } finally {
    bitmap.close();
  }
}
