// @target flowdesk
const prompt = `Generate an image.

A single ESP32 DevKit V1 development board photographed from a three-quarter angle on a seamless off-white background. Dark blue PCB, silver metal RF shield can, black micro-USB port, two rows of black header pins. Soft diffused studio light from the upper left, gentle contact shadow. Sharp product photography, shallow depth of field. No legible text or logos on the board. Square format.`

const result = await window.electronAPI.debugAskBrowserProviderDirect('chatgpt', prompt, true)
return result
