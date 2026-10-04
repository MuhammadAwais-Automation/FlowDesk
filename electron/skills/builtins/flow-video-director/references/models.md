# Google Flow Video Models Reference

Captured on: 2026-09-28
Source RPC: `flow.videoModels` (`electron/flow.ts:337`, `electron/gateway/localGateway.ts:537`)
Underlying Protocol: Google Flow batchexecute `yBhWQ` (`electron/flowBridge.ts:509-526`)
Network Capture Evidence: `probes/out/_network-flow-google-com.SESSION2.json`

---

## 1. Raw Model Keys Returned by `yBhWQ`

When querying Google Flow's model registry via `callBatch('yBhWQ', [])`, Flow returns the active model family identifiers:

| Model Identifier | Description | Tier / Weight |
|---|---|---|
| `veo_3_1_quality` | DeepMind Veo 3.1 high-fidelity render engine | 1 |
| `veo_3_1_lite` | DeepMind Veo 3.1 lightweight / rapid preview engine | 1 |
| `abra` | Google Flow core generative video pipeline | 1 |
| `veo_3_1_fast` | DeepMind Veo 3.1 fast synthesis engine | 1 |

Wire payload captured in `_network-flow-google-com.SESSION2.json` (line 12389):
```json
)]}'

187
[["wrb.fr","yBhWQ","[[[\"veo_3_1_quality\",1],[\"veo_3_1_lite\",1],[\"abra\",1],[\"veo_3_1_fast\",1]]]",null,null,null,"generic"],["di",518],["af.httprm",518,"6722550304518183840",167]]
25
[["e",4,null,null,223]]
```

---

## 2. Generation & Execution Keys Captured in Live Network Traffic

During live video generation, image-to-video animation, and scene extensions, the Flow web client submits specific composite keys containing duration and modality flags:

### Text-to-Video (`flow_generate_video` / RPC `YhhmEf`)
- `abra_t2v_10s`: 10-second high-resolution text-to-video generation.
  - *Evidence*: `probes/out/_network-flow-google-com.SESSION2.json` line 11717 (`postData` contains `\"videoModelKey\":\"abra_t2v_10s\"`).
  - *Credits spent*: 22 credits per generation (account balance decremented from 1050 to 1028 to 828).
- `abra_t2v_8s`: 8-second standard text-to-video generation.
  - *Evidence*: `probes/out/_network-flow-google-com.SESSION2.json` lines 12400-12500 (media item metadata indicates model `abra_t2v_8s`), schema description in `bin/flowdesk-mcp.mjs:1678`.

### Image-to-Video (`flow_generate_video_from_image` / RPC `MZZa6b`)
- `abra_r2v_10s`: 10-second image-to-video animation using an existing image media ID as the opening anchor frame ("r2v" = reference/image to video).
  - *Evidence*: `electron/flowBridge.ts:755` ("The captured model key was abra_r2v_10s — r2v where text-to-video used t2v"), schema description in `bin/flowdesk-mcp.mjs:1698`.

### Video Scene Extension (`flow_extend_video` / RPC `jIps6`)
- `abra_edit`: Generates a continuous extension from an existing video scene using frames 0..240 of the source clip.
  - *Evidence*: `electron/flowBridge.ts:793-810` ("The captured call used frames 0..240 of the source and the model key abra_edit").

---

## 3. Best Practice for Model Selection

1. For new standalone text-to-video clips, pass `abra_t2v_10s` (or `abra_t2v_8s` for shorter 8-second pacing).
2. For animating a keyframe image asset created via `flow-image-artist`, pass `abra_r2v_10s` to `flow_generate_video_from_image`.
3. For extending an existing scene, invoke `flow_extend_video` (which automatically targets `abra_edit`).
4. At runtime, the agent can call `flow_video_models` to verify active model availability from the live Flow session.
