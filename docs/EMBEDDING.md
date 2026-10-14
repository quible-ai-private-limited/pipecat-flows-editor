# Embedding the editor (Quibble fork)

The Dashboard shows the editor in an iframe at `/editor?embed=1` and talks to it with `postMessage`. The message types are in `lib/embed/protocol.ts`, and the editor side is `hooks/useEmbedBridge.ts`.

## Allowed origins

The editor only accepts messages from, and only posts to, the origins listed in `NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS`. The list is comma-separated, with no trailing slash, and `*` is never accepted.

- **Local:** `.env.development` lists `http://localhost:5173` (the Dashboard) and `http://localhost:5500` (the test page).
- **Hosted builds:** set the variable in the hosting environment, for example `https://stage.platform.quibbleai.io` for stage. It is read at build time, so a change needs a rebuild.

When embedded, the editor does not restore or autosave its browser draft. The Dashboard owns the flow.

- **Theme:** embedded, the editor starts in the light theme. A theme the user picks in the editor's theme menu is remembered by the browser and kept.
- **View-only preview:** `/editor?embed=1&view=1` shows the flow without the toolbar, side panel or YAML pane. Cards cannot be selected, moved or edited; the pointer only pans and zooms. Use it for the read-only preview in the agent page. The messages are the same: load the flow with `LOAD_FLOW` after `EDITOR_READY`. No `FLOW_CHANGED` is sent, because nothing can be edited.

## Hosting

`next.config.ts` sets `output: "export"`, so `npm run build` writes a static site to `out/`. `/editor` is `out/editor.html`. A static site cannot send HTTP headers, so the host must set the header that limits who may embed the editor, for example `Content-Security-Policy: frame-ancestors https://stage.platform.quibbleai.io`.

## Messages

| Direction | Message | Meaning |
|---|---|---|
| editor → Dashboard | `{type: "EDITOR_READY"}` | Ready. Answer with `LOAD_FLOW` or `NEW_FLOW`. |
| Dashboard → editor | `{type: "LOAD_FLOW", payload: {flowName, yaml?, flow?, positions?}}` | Open a saved flow. `yaml` is preferred because it keeps comments. Otherwise `flow` (a FlowConfig object) is used. `positions` restores the canvas layout. Without it, the flow is laid out automatically. |
| editor → Dashboard | `{type: "FLOW_LOADED", ok, error?}` | The result of `LOAD_FLOW`. **If `ok` is false, do not let Save overwrite the stored flow.** |
| Dashboard → editor | `{type: "NEW_FLOW"}` | No flow yet. The editor shows its start screen. |
| Dashboard → editor | `{type: "GET_FLOW", requestId?}` | Send this when the user clicks Save. |
| editor → Dashboard | `{type: "FLOW_DATA", requestId, payload: {flowName, flow, yaml, positions, issues, hasErrors}}` | The current flow. **If `hasErrors` is true, do not save.** Show the `issues` with `level: "error"` instead, because Pipecat would refuse that flow at call time. |
| editor → Dashboard | `{type: "FLOW_CHANGED"}` | The flow was edited. Mark it unsaved, and clear the mark after a successful save. Moving cards only does not count as an edit. |

The Dashboard should accept messages only when `event.origin` is the editor's origin and `event.source` is the iframe's window. It should post to the editor's origin, not `"*"`.

## Saving

Save through the existing `POST /conversationFlow/saveconversationflow`, which creates a new version:

```json
{
  "agentId": "…",
  "flowType": "pipecat",
  "commitmessage": "…",
  "data": {
    "pipecatFlowJson": "<payload.flow>",
    "pipecatFlowYaml": "<payload.yaml>",
    "pipecatFlowPositions": "<payload.positions>",
    "savedAt": "<ISO time>"
  }
}
```

The Pipecat agent runs `pipecatFlowJson`. To load a version, send `LOAD_FLOW` with `yaml: data.pipecatFlowYaml`, `flow: data.pipecatFlowJson` and `positions: data.pipecatFlowPositions`. A version saved by the old editor (a `nodes` list) is converted when it is opened.

## Trying it locally

1. Start the editor: `npx next dev -p 3001`. In PowerShell, `npm run dev -- -p 3001` drops the port.
2. Serve the test page: `npx --yes serve@14.2.4 tools/embed-test -l 5500`.
3. Open `http://localhost:5500`. The page plays the Dashboard's part. It can load a flow file (a FlowConfig JSON, YAML, or a saved version's `data`), start a new flow, save (`GET_FLOW`), reopen what was saved, and download `pipecatFlowJson`.
