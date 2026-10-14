import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configToCanvas } from "@/lib/convert/configToCanvas";
import { parseFlowYaml } from "@/lib/document/flowDocument";
import {
  flowTextFromPayload,
  isEmbedMode,
  isViewMode,
  parentOriginFromReferrer,
  parseAllowedOrigins,
  parseHostMessage,
} from "@/lib/embed/protocol";
import { flowSnapshot } from "@/lib/embed/snapshot";

const FLOW_YAML = `initial_node: greeting
nodes:
  greeting:
    role_message: You are a helpful assistant for {{ userName }}.
    task_messages:
      - role: developer
        content: Greet the user.
    functions:
      - name: done
        transition_only: true
        description: The user is finished.
        transition_to: goodbye
  goodbye:
    task_messages:
      - role: developer
        content: Say goodbye.
    post_actions:
      - type: end_conversation
`;

function snapshotOf(yaml: string) {
  const parsed = parseFlowYaml(yaml);
  if (!parsed.config) throw new Error("fixture does not parse");
  const canvas = configToCanvas(parsed.config);
  return flowSnapshot(canvas.nodes, {
    flowName: "timesheet",
    document: parsed.document,
    globalFunctions: parsed.config.global_functions ?? [],
    initialNode: parsed.config.initial_node,
  });
}

describe("embed protocol", () => {
  it("detects embedded mode from the query", () => {
    expect(isEmbedMode("?embed=1")).toBe(true);
    expect(isEmbedMode("?embed=0")).toBe(false);
    expect(isEmbedMode("")).toBe(false);
  });

  it("detects the view-only preview only when embedded", () => {
    expect(isViewMode("?embed=1&view=1")).toBe(true);
    expect(isViewMode("?embed=1")).toBe(false);
    expect(isViewMode("?view=1")).toBe(false);
  });

  it("normalizes the allowed origins and never allows *", () => {
    expect(
      parseAllowedOrigins(" http://localhost:5173/ , https://stage.platform.quibbleai.io,*,")
    ).toEqual(["http://localhost:5173", "https://stage.platform.quibbleai.io"]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it("takes the parent origin from the referrer only when it is allowed", () => {
    const allowed = ["https://stage.platform.quibbleai.io"];
    expect(
      parentOriginFromReferrer("https://stage.platform.quibbleai.io/pipecat-stage/1", allowed)
    ).toBe("https://stage.platform.quibbleai.io");
    expect(parentOriginFromReferrer("https://evil.example/page", allowed)).toBeNull();
    expect(parentOriginFromReferrer("", allowed)).toBeNull();
  });

  it("accepts the host messages and ignores anything else", () => {
    expect(parseHostMessage({ type: "NEW_FLOW" })).toEqual({ type: "NEW_FLOW" });
    expect(parseHostMessage({ type: "GET_FLOW", requestId: 7 })).toEqual({
      type: "GET_FLOW",
      requestId: 7,
    });
    expect(parseHostMessage({ type: "GET_FLOW", requestId: {} })).toEqual({ type: "GET_FLOW" });
    expect(parseHostMessage("LOAD_FLOW")).toBeNull();
    expect(parseHostMessage({ type: "LOAD_FLOW" })).toBeNull();
    expect(parseHostMessage({ type: "SOMETHING_ELSE" })).toBeNull();
    expect(
      parseHostMessage({
        type: "LOAD_FLOW",
        payload: { flowName: " timesheet ", yaml: FLOW_YAML, positions: { a: { x: "1" } } },
      })
    ).toEqual({
      type: "LOAD_FLOW",
      payload: { flowName: "timesheet", yaml: FLOW_YAML, flow: undefined, positions: undefined },
    });
  });

  it("opens the YAML when there is one, else the FlowConfig as JSON", () => {
    const config = parseFlowYaml(FLOW_YAML).config;
    expect(flowTextFromPayload({ yaml: FLOW_YAML, flow: config })).toBe(FLOW_YAML);
    const fromJson = parseFlowYaml(flowTextFromPayload({ flow: config }) ?? "");
    expect(fromJson.config).toEqual(config);
    expect(flowTextFromPayload({})).toBeNull();
  });
});

describe("flow snapshot", () => {
  it("returns the FlowConfig, its YAML and positions for a valid flow", () => {
    const data = snapshotOf(FLOW_YAML);
    expect(data.hasErrors).toBe(false);
    expect(data.flowName).toBe("timesheet");
    expect(data.flow).toEqual(parseFlowYaml(FLOW_YAML).config);
    expect(parseFlowYaml(data.yaml).config).toEqual(data.flow);
    expect(Object.keys(data.positions)).toEqual(expect.arrayContaining(["greeting", "goodbye"]));
    expect(JSON.parse(JSON.stringify(data))).toEqual(data); // plain data, safe to post
  });

  it("reports the errors Pipecat would refuse the flow for", () => {
    const data = snapshotOf(FLOW_YAML.replace("transition_to: goodbye", "transition_to: nowhere"));
    expect(data.hasErrors).toBe(true);
    expect(data.issues.some((i) => i.level === "error" && i.message.includes("nowhere"))).toBe(
      true
    );
  });
});

describe("embed bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function renderBridge(allowed: string) {
    vi.stubEnv("NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS", allowed);
    vi.resetModules();
    const { useEmbedBridge } = await import("@/hooks/useEmbedBridge");
    const handlers = {
      onLoad: vi.fn(() => true),
      onNew: vi.fn(),
      snapshot: vi.fn(() => snapshotOf(FLOW_YAML)),
    };
    renderHook(() => useEmbedBridge(true, handlers));
    const send = (data: unknown, origin: string) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, origin, source: window }));
      });
    return { handlers, send };
  }

  it("acts only on messages from an allowed origin", async () => {
    const { handlers, send } = await renderBridge("http://localhost:5500");
    send({ type: "NEW_FLOW" }, "https://evil.example");
    expect(handlers.onNew).not.toHaveBeenCalled();
    send({ type: "NEW_FLOW" }, "http://localhost:5500");
    expect(handlers.onNew).toHaveBeenCalledTimes(1);
    send({ type: "LOAD_FLOW", payload: { yaml: FLOW_YAML } }, "http://localhost:5500");
    expect(handlers.onLoad).toHaveBeenCalledWith(expect.objectContaining({ yaml: FLOW_YAML }));
  });

  it("does nothing when no origin is allowed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handlers, send } = await renderBridge("");
    send({ type: "NEW_FLOW" }, "http://localhost:5500");
    expect(handlers.onNew).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
