import assert from "node:assert/strict";
import test from "node:test";
import * as journey from "../../lib/journey";
import { loadModule } from "../helpers/load-module";

function fixture(failWrite = false, refreshed = true) {
  const directory: journey.Directory = {
    revision: 7,
    channels: [{ name: "Board", url: "https://example.test", logoUrl: "" }],
    companies: [
      { name: "Existing", website: "https://old.example.test", logoUrl: "" },
      { name: "Keep", website: "", logoUrl: "" },
    ],
  };
  const events: string[] = [];
  let sent: journey.Directory | undefined;
  let accepted: journey.Directory | undefined;
  const hook = loadModule<typeof import("../../components/app/use-directory-mutations")>(
    new URL("../../components/app/use-directory-mutations.ts", import.meta.url),
    {
      "@/lib/journey": journey,
      "./store": {
        useDesk: () => ({
          data: { directory },
          acceptDirectory: (saved: journey.Directory) => {
            events.push("accept");
            accepted = saved;
          },
          refreshAfterWrite: async () => {
            events.push("refresh");
            return refreshed;
          },
        }),
        postJson: async (path: string, body: { directory: journey.Directory }) => {
          assert.equal(path, "/api/directory");
          events.push("write");
          sent = body.directory;
          if (failWrite) throw Error("revision conflict");
          return { ...body.directory, revision: 8 };
        },
      },
    },
  );
  return {
    save: hook.useDirectoryMutations(),
    directory,
    events,
    sent: () => sent,
    accepted: () => accepted,
  };
}
const editor = {
  type: "company" as const,
  name: "Existing",
  url: "https://new.example.test",
  logoUrl: "",
  existing: true,
};

test("directory write accepts the server revision before refresh and preserves unrelated profiles", async () => {
  const f = fixture(false, false);
  assert.equal(
    await f.save(editor, ["Existing", "Keep"]),
    false,
    "read failure is not a write exception",
  );
  assert.deepEqual(f.events, ["write", "accept", "refresh"]);
  assert.equal(f.sent()!.revision, 7);
  assert.equal(f.accepted()!.revision, 8);
  assert.deepEqual(f.sent()!.channels, f.directory.channels);
  assert.deepEqual(f.sent()!.companies, [
    f.directory.companies[1],
    { name: "Existing", website: "https://new.example.test", logoUrl: "" },
  ]);
  assert.equal(
    f.directory.companies[0].website,
    "https://old.example.test",
    "snapshot stays immutable",
  );
});

test("failed directory writes neither replace local state nor refresh away the editor input", async () => {
  const f = fixture(true);
  await assert.rejects(f.save(editor, []), /revision conflict/);
  assert.deepEqual(f.events, ["write"]);
  assert.equal(f.accepted(), undefined);
});

test("validation and normalized duplicate names reject before any directory write", async () => {
  const f = fixture();
  await assert.rejects(f.save({ ...editor, url: "javascript:alert(1)" }, []), /完整的网站地址/);
  await assert.rejects(
    f.save({ ...editor, name: " existing ", existing: false }, ["Existing"]),
    /同名的公司/,
  );
  assert.deepEqual(f.events, []);
  assert.equal(
    await f.save({ ...editor, type: "channel", name: "New Board", existing: false }, ["Board"]),
    true,
  );
  assert.deepEqual(f.sent()!.companies, f.directory.companies);
  assert.equal(f.sent()!.channels.length, 2);
});
