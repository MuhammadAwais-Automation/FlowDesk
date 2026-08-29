// @target flowdesk
const result = await window.electronAPI.debugAskBrowserProviderDirect(
  'chatgpt',
  'Generate an image: a 3D pixel art style blueprint of a spaceship, showing schematic/blueprint-style design with technical annotations, on a blue blueprint background.',
  true
)
return result
