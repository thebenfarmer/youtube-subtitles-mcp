#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('=== Testing New Compression System ===\n');

// Test with the 45-minute video using different compression levels
const server = spawn('node', ['/Users/benni/Documents/MCP/youtube-mcp/dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseCount = 0;
let testResults = [];

server.stdout.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString());
    if (response.result && response.result.content) {
      const content = response.result.content[0].text;
      const testCase = response.id === 2 ? 'FULL' : response.id === 3 ? 'MEDIUM' : 'SUMMARY';
      
      console.log(`✅ ${testCase} - Length: ${content.length} characters`);
      testResults.push({
        level: testCase,
        length: content.length,
        content: content.substring(0, 200) + '...'
      });
      responseCount++;
    } else {
      console.log('✅ Protocol response:', response.id || response.method);
    }
  } catch (error) {
    console.log('❌ Invalid JSON:', data.toString().substring(0, 100));
  }
});

server.stderr.on('data', (data) => {
  try {
    const logEntry = JSON.parse(data.toString());
    console.log(`📋 [${logEntry.level}] ${logEntry.message}`);
  } catch (error) {
    console.log('📋 Raw log:', data.toString().substring(0, 200));
  }
});

// Test sequence
console.log('🎬 Testing video: https://youtu.be/Er2s-CFoZSo?si=qtEnhg9vFHV57NGz\n');
setTimeout(() => {
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'compression-test', version: '1.0.0' }
    }
  };
  server.stdin.write(JSON.stringify(initRequest) + '\n');
  
  // Test 1: Full compression
  setTimeout(() => {
    console.log('📥 Testing FULL compression...');
    const request = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_youtube_subtitles',
        arguments: {
          url: 'https://youtu.be/Er2s-CFoZSo?si=qtEnhg9vFHV57NGz',
          language: 'en',
          maxLength: 60000,
          compressionLevel: 'full'
        }
      }
    };
    server.stdin.write(JSON.stringify(request) + '\n');
  }, 1500);
  
  // Test 2: Medium compression
  setTimeout(() => {
    console.log('📥 Testing MEDIUM compression...');
    const request = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_youtube_subtitles',
        arguments: {
          url: 'https://youtu.be/Er2s-CFoZSo?si=qtEnhg9vFHV57NGz',
          language: 'en',
          maxLength: 40000,
          compressionLevel: 'medium'
        }
      }
    };
    server.stdin.write(JSON.stringify(request) + '\n');
  }, 30000);
  
  // Test 3: Summary compression
  setTimeout(() => {
    console.log('📥 Testing SUMMARY compression...');
    const request = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_youtube_subtitles',
        arguments: {
          url: 'https://youtu.be/Er2s-CFoZSo?si=qtEnhg9vFHV57NGz',
          language: 'en',
          maxLength: 20000,
          compressionLevel: 'summary'
        }
      }
    };
    server.stdin.write(JSON.stringify(request) + '\n');
  }, 60000);
  
  // Analyze results
  setTimeout(() => {
    console.log('\n📊 Compression Test Results:');
    testResults.forEach(result => {
      console.log(`   ${result.level}: ${result.length} chars`);
      console.log(`   Sample: "${result.content}"`);
      console.log('');
    });
    
    server.kill('SIGTERM');
  }, 90000);
}, 500);