import { afterEach, describe, expect, it, vi } from "vitest";
import { formatIssueBody, onRequestPost, type Env } from "../functions/api/report-issue.ts";

const env: Env = { GITHUB_TOKEN: "ghp_test", TURNSTILE_SECRET_KEY: "secret" };

function post(body: unknown, environment = env) {
  return onRequestPost({
    request: new Request("https://example.com/api/report-issue", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env: environment,
  });
}

const valid = { title: "Wrong AR", description: "It says 500, game says 510", turnstileToken: "t" };

/** Mocks Turnstile's verification and GitHub's issue API, recording the calls */
function mockFetch({ verified = true, githubStatus = 201 } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("turnstile")) return Response.json({ success: verified });
    if (url.includes("api.github.com")) {
      return githubStatus === 201
        ? Response.json({ html_url: "https://github.com/o/r/issues/1" }, { status: 201 })
        : new Response("nope", { status: githubStatus });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("report-issue function", () => {
  it("files an issue as the bot and returns its URL", async () => {
    const fetchMock = mockFetch();
    const res = await post({ ...valid, settings: { str: 40 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://github.com/o/r/issues/1" });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.github.com/repos/illiterati1/elden-ring-stat-optimizer/issues");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer ghp_test");
    const issue = JSON.parse(init!.body as string);
    expect(issue.title).toBe("Wrong AR");
    expect(issue.body).toContain("It says 500, game says 510");
    expect(issue.body).toContain('"str": 40');
  });

  it("doesn't file anything when verification fails", async () => {
    const fetchMock = mockFetch({ verified: false });
    const res = await post(valid);
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quietly drops reports that fill in the hidden field", async () => {
    const fetchMock = mockFetch();
    const res = await post({ ...valid, website: "spam.example" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or overlong fields before verifying", async () => {
    const fetchMock = mockFetch();
    expect((await post({ ...valid, title: " " })).status).toBe(400);
    expect((await post({ ...valid, title: "x".repeat(121) })).status).toBe(400);
    expect((await post({ ...valid, description: "" })).status).toBe(400);
    expect((await post({ ...valid, description: "x".repeat(5001) })).status).toBe(400);
    expect((await post({ ...valid, turnstileToken: "" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says it isn't set up without its secrets", async () => {
    mockFetch();
    expect((await post(valid, {})).status).toBe(503);
  });

  it("reports GitHub failures without leaking details", async () => {
    mockFetch({ githubStatus: 401 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(valid);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("nope");
  });
});

describe("formatIssueBody", () => {
  it("breaks @mentions and #references", () => {
    const body = formatIssueBody("cc @someone, see #12", undefined);
    expect(body).not.toMatch(/@someone|#12/);
    expect(body).toContain("@​someone");
  });

  it("fences settings so backticks in them can't escape", () => {
    const body = formatIssueBody("x", { note: "```" });
    expect(body).toContain("````json");
  });

  it("leaves out settings that are too large", () => {
    const body = formatIssueBody("x", { big: "x".repeat(60000) });
    expect(body).toContain("too large to include");
    expect(body.length).toBeLessThan(1000);
  });
});
