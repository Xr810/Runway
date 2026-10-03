// Run locally to create a password hash without storing plaintext in shell history.
// The output matches lib/accounts.ts (`scrypt$N$r$p$salt$hash`) so it can be inserted
// into password_credentials.password_hash directly (#30).
import { randomBytes, scryptSync } from "node:crypto";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  throw Error("Run this command in an interactive terminal.");
}
process.stderr.write("New Runway password (hidden): ");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
let password = "";
function finish(code) {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  password = "";
  process.exit(code);
}
process.stdin.on("data", chunk => {
  for (const char of chunk) {
    if (char === "\u0003" || char === "\u0004") finish(1);
    if (char === "\r" || char === "\n") {
      process.stderr.write("\n");
      if (password.length < 10) {
        process.stderr.write("Choose a password of at least 10 characters.\n");
        finish(1);
      }
      const salt = randomBytes(16).toString("base64url");
      const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64url");
      console.log(`scrypt$16384$8$1$${salt}$${hash}`);
      finish(0);
    }
    if (char === "\u007f" || char === "\b") password = Array.from(password).slice(0, -1).join("");
    else if (char >= " ") password += char;
  }
});
