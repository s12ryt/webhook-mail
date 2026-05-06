import type { Request } from "express";

export function parseCookies(request: Request): Record<string, string> {
  const header = request.header("cookie");
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 0) {
        return [part.trim(), ""];
      }

      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      return [key, decodeURIComponent(value)];
    })
  );
}
