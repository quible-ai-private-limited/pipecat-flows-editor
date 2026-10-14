/**
 * The flow on the canvas as the host page saves it: the FlowConfig, its YAML,
 * the canvas positions, and the same checks the editor shows.
 */

import type { Document } from "yaml";

import type { FlowCanvasNode } from "@/lib/convert/configToCanvas";
import { hasFlowErrors, parseFlowYaml } from "@/lib/document/flowDocument";
import { serializeFlow } from "@/lib/document/serializeFlow";
import type { FlowConfigFunction } from "@/lib/schema/flowConfig";
import { positionsFromNodes } from "@/lib/storage/positionStore";
import type { FlowIssue } from "@/lib/validation/flowIssues";

import type { FlowDataPayload } from "./protocol";

export function flowSnapshot(
  nodes: ReadonlyArray<FlowCanvasNode>,
  state: {
    flowName: string;
    document: Document | null;
    globalFunctions: FlowConfigFunction[];
    initialNode: string;
  }
): FlowDataPayload {
  const { text, config } = serializeFlow(nodes, {
    document: state.document,
    globalFunctions: state.globalFunctions,
    initialNode: state.initialNode,
  });
  // Re-read the text the way a Pipecat application would, so the checks
  // include the schema and the config is the one that loads.
  const parsed = parseFlowYaml(text);
  const issues: FlowIssue[] = parsed.issues.map(({ level, code, message, node, function: fn }) => ({
    level,
    code,
    message,
    ...(node !== undefined && { node }),
    ...(fn !== undefined && { function: fn }),
  }));
  for (const message of parsed.yamlErrors) {
    issues.unshift({ level: "error", code: "schema", message });
  }
  return {
    flowName: state.flowName,
    flow: parsed.config ?? config,
    yaml: text,
    positions: positionsFromNodes(nodes),
    issues,
    hasErrors: hasFlowErrors(parsed),
  };
}
