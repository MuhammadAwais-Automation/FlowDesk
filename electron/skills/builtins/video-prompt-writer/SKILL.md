---
name: video-prompt-writer
title: "Flow Video Prompt Writer"
description: "Structures natural-language directorial prompts for Google Flow video models with shot framing, motion dynamics, atmospheric lighting, and audio design. Use when composing prompts for text-to-video or animating keyframes."
version: 2.0.0
domain: flow
tools:
  - flow_video_models
inputs:
  topic:
    type: string
    required: true
    description: "Core video concept, character, scene, or marketing topic"
  duration:
    type: string
    required: false
    default: 10s
    description: "Target clip length: Flow offers 4, 6, 8 or 10 seconds (the seconds setting of flow_generate_video)"
  styleAnchor:
    type: string
    required: false
    description: "Visual style anchor (e.g. broadcast documentary, cinematic 35mm film, hyper-realistic macro)"
  cameraMovement:
    type: string
    required: false
    description: "Camera motion direction (e.g. low-angle tracking shot, slow push-in, handheld stabilizer)"
  audioDesign:
    type: string
    required: false
    description: "Native audio and soundscape directives (e.g. ambient wind, realistic footsteps, crowd cheering)"
---

## When to use
- Composing professional, cinema-grade prompts for Google Flow text-to-video (`flow_generate_video`).
- Writing motion and physics conditioning prompts for image-to-video animation (`flow_generate_video_from_image`).
- Formatting multi-shot continuous sequences that cleanly fit the clip length chosen in Flow (4, 6, 8 or 10 seconds).
- Structuring native audio and environmental soundscape directives into prompts for models that synthesize sound effects.

## When not to use
- Executing the actual video generation or downloading files (use `google-flow` instead).
- Generating static thumbnail images or uploading local graphic files (use `google-flow` instead).
- Writing social media captions, titles, or marketing copy for publication (use `caption-hashtag-writer` instead).

## Tools

### flow_video_models
Reads the video models Flow's own settings menu offers (live 2026-10-13: Omni 1.1 Flash, Veo 3.1 - Lite / Fast / Quality), the current settings and the credits Flow quotes.
- **Parameters**: `projectId` (any project of the account), `account?`.
- **Known failure shapes**:
  an error naming the missing project or account; see the `google-flow` skill.

## Procedure

1. **Determine Clip Duration and Model Target**:
   Choose the clip length Flow offers (`seconds`: 4, 6, 8 or 10) and a model by the name `flow_video_models` lists
   (for example "Omni 1.1 Flash"). A frame or reference image (`startFrame`, `ingredients`) is passed to
   `flow_generate_video`; the prompt then describes how it moves.

2. **Select a Stylistic Reference Anchor**:
   Establish a single coherent visual style anchor rather than a laundry list of technical camera parameters:
   - *Documentary style*: "Broadcast-realistic 4K wildlife documentary footage, natural lighting, authentic fur interaction."
   - *Cinematic narrative*: "35mm anamorphic film look, cinematic golden hour volumetric backlight, shallow depth of field."
   - *Social creator style*: "Authentic handheld phone camera perspective, eye-level natural movement, vibrant real-world lighting."

3. **Frame the Camera & Motion Trajectory**:
   Describe the camera movement in the opening sentence:
   - Specify angle: *Low-angle tracking shot*, *Smooth forward dolly*, *Static tight close-up*, *Slow push-in*.
   - Describe focal continuity: ensure the subject remains centered or moves predictably within the viewport without sudden teleportation.

4. **Define Continuous Physical Action (Temporal Pacing)**:
   Ensure the described physical action realistically fits the 8-to-10 second window:
   - Single continuous action: e.g. An athlete chalks paws, sets posture, and deadlifts a barbell overhead.
   - Micro multi-shot sequence: use clean shot breaks (e.g. `SHOT 1 (4 seconds): ... --- SHOT 2 (4 seconds): ...`) with clear cuts between continuous perspectives.

5. **Direct Native Soundscape & Audio Atmosphere**:
   Google Flow video synthesis generates native synchronized audio. Detail authentic environmental acoustics:
   - Physical contact sounds: paws crunching on snow, barbell clanging on turf, rapid water splashing.
   - Ambient soundscape: distant stadium roar, mountain wind gusts, realistic breathing.
   - Explicit negative sound directive: "No cheesy cartoon background music, natural sound design only."

6. **Filter Hallucination Hazards**:
   - **Never include platform names**: Do NOT write "TikTok", "Instagram", or "YouTube" in the prompt text. Neural video models will hallucinate watermarks, logos, or app interface overlays onto the footage.
   - Avoid negative prompt checklists (`"no blur, no ugly, no artifacts"`). Describe what IS visible with positive, high-fidelity language.

7. **Hand Off Clean Prompt**:
   Output the completed prompt directly to `google-flow` (`flow_generate_video` or `flow_generate_video_from_image`).

## Limits and safety
- **Temporal Durations**: Flow clips are 4, 6, 8 or 10 seconds. Prompts describing multi-minute story arcs will fail to animate properly.
- **Aspect Ratio Formatting**: Flow models default to landscape or vertical portrait orientations. Format scene blocking so that central action remains safely inside the primary viewport.
- **Character Consistency**: For multi-video episodic series, maintain an unchanging character anchor description (exact breed, distinctive clothing or gear, eye color) across all prompts.

## Verified facts
- Live Flow video generation calls in `probes/out/_network-flow-google-com.SESSION2.json` (line 11717) demonstrated structured prompts containing multi-shot breakdowns (`SHOT 1 — Wide tracking shot (4 seconds) ... SHOT 2 — Medium shot (4 seconds)`).
- Flow's video models accept text prompt scenes up to several paragraphs with embedded sound design instructions (`_network-flow-google-com.SESSION2.json:11717`).
- Flow video models generate native audio directly alongside visual synthesis (`probes/out/_network-flow-google-com.SESSION2.json:11717`).
- Image-to-video prompts describe how the initial keyframe animates into action; the image goes in as `startFrame` or `ingredients` (live 2026-10-13/14).

## Not verified
- Lip-synced dialogue: Generative video models do not reliably synchronize precise spoken words with lip movements. Dialogues should be kept to off-screen reactions or non-verbal vocalisations.
