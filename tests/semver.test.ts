import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSemVer} from '../src/shared/semver';
import {UpdateChecker} from '../src/electron/services/UpdateChecker';

const artifact={
  name:'Clawd-1.2.0-windows-x64.exe',size:99_000_000,sha256:'a'.repeat(64),
  download_url:'https://clawd-updates.chronokalamos.com/v1/download/v1.2.0/Clawd-1.2.0-windows-x64.exe',
  fallback_url:'https://github.com/LYL-Z/clawd-desktop/releases/download/v1.2.0/Clawd-1.2.0-windows-x64.exe',
};

test('semantic version comparison handles numeric, prerelease and build metadata precedence',()=>{
  assert.equal(compareSemVer('1.10.0','1.9.9'),1);
  assert.equal(compareSemVer('v2.0.0','1.99.99'),1);
  assert.equal(compareSemVer('1.2.3-rc.2','1.2.3-rc.10'),-1);
  assert.equal(compareSemVer('1.2.3-rc.1','1.2.3'),-1);
  assert.equal(compareSemVer('1.2.3+build.5','1.2.3+build.9'),0);
  assert.equal(compareSemVer('01.2.3','1.2.3'),null);
});

test('manual update check distinguishes available, current and locally newer builds',async()=>{
  const payload={tag_name:'v1.2.0',name:'Clawd 1.2.0',body:'## Changes',published_at:'2026-10-18T12:00:00Z',draft:false,prerelease:false,artifact};
  const available=await new UpdateChecker(async()=>payload).check('1.1.0');
  assert.equal(available.status,'available');
  if(available.status==='available')assert.deepEqual(available.artifact.sources.map(source=>source.kind),['edge','github']);
  assert.equal((await new UpdateChecker(async()=>payload).check('1.2.0')).status,'current');
  assert.equal((await new UpdateChecker(async()=>payload).check('1.3.0')).status,'ahead');
});

test('update check rejects prereleases, invalid tags and excessive release notes',async()=>{
  const prerelease=await new UpdateChecker(async()=>({tag_name:'v1.2.0-rc.1',prerelease:true})).check('1.1.0');
  assert.equal(prerelease.status,'unavailable');
  const malformed=await new UpdateChecker(async()=>({tag_name:'latest'})).check('1.1.0');
  assert.equal(malformed.status,'unavailable');
  const long=await new UpdateChecker(async()=>({tag_name:'v2.0.0',body:'x'.repeat(20000),artifact:{...artifact,name:'Clawd-2.0.0-windows-x64.exe',download_url:'https://clawd-updates.chronokalamos.com/v1/download/v2.0.0/Clawd-2.0.0-windows-x64.exe',fallback_url:'https://github.com/LYL-Z/clawd-desktop/releases/download/v2.0.0/Clawd-2.0.0-windows-x64.exe'}})).check('1.1.0');
  assert.equal(long.status,'available');if(long.status==='available')assert.equal(long.releaseNotes.length,12000);
});

test('update check refuses unverified or off-host package metadata',async()=>{
  const result=await new UpdateChecker(async()=>({tag_name:'v2.0.0',artifact:{...artifact,download_url:'https://attacker.example/setup.exe'}})).check('1.1.0');
  assert.equal(result.status,'unavailable');
});

test('update check reduces network failures to a user-safe message',async()=>{
  const result=await new UpdateChecker(async()=>{throw new Error('timeout');}).check('1.1.0');
  assert.equal(result.status,'unavailable');
  if(result.status==='unavailable')assert.match(result.message,/超时/);
});
