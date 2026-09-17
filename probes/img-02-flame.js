// @target flowdesk
const prompt = `Generate an image.

A small IR flame sensor module on a seamless off-white background. Compact blue-black PCB with a single dark IR photodiode dome at the front, a blue trimmer potentiometer, two small indicator LEDs, and a four-pin header. Three-quarter angle, soft diffused studio light, gentle contact shadow. Sharp product photography. No legible text or logos. Square format.`
const result = await window.electronAPI.debugAskBrowserProviderDirect('chatgpt', prompt, true)
return result
