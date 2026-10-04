// @target tiktok.com
const j = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true&_=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(r => r.json())
return { bio: j.userExtra.profileBio }
