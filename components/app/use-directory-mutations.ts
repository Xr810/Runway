"use client";
import { channelSchema, companyProfileSchema, identity, type Directory } from "@/lib/journey";
import { postJson, useDesk } from "./store";

export type DirectoryEditor = {
  type: "company" | "channel";
  name: string;
  url: string;
  logoUrl: string;
  existing: boolean;
};

/** Compose a revision-checked directory save; dialogs and busy state stay in the view. */
export function useDirectoryMutations() {
  const { data, acceptDirectory, refreshAfterWrite } = useDesk();
  return async (editor: DirectoryEditor, knownNames: readonly string[]) => {
    const parsed =
      editor.type === "company"
        ? companyProfileSchema.safeParse({
            name: editor.name,
            website: editor.url,
            logoUrl: editor.logoUrl,
          })
        : channelSchema.safeParse({ name: editor.name, url: editor.url, logoUrl: editor.logoUrl });
    if (!parsed.success) throw Error(parsed.error.issues[0].message);
    const profile = parsed.data;
    if (!editor.existing && knownNames.some((name) => identity(name) === identity(profile.name)))
      throw Error(
        editor.type === "channel"
          ? "已经有同名的渠道了，请直接编辑它"
          : "已经有同名的公司了，请直接编辑它",
      );
    const directory = data.directory;
    const next =
      editor.type === "company"
        ? {
            ...directory,
            companies: [
              ...directory.companies.filter((c) => identity(c.name) !== identity(profile.name)),
              companyProfileSchema.parse(profile),
            ],
          }
        : {
            ...directory,
            channels: [
              ...directory.channels.filter((c) => identity(c.name) !== identity(profile.name)),
              channelSchema.parse(profile),
            ],
          };
    const saved = await postJson<Directory>("/api/directory", { action: "save", directory: next });
    acceptDirectory(saved);
    return refreshAfterWrite();
  };
}
