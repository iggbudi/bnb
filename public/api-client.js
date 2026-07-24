'use strict';

async function fetchApi(endpoint, options = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        ...options,
        headers: { Accept: 'application/json', ...(options.headers || {}) },
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data.data;
    } catch (error) {
      const isNetworkError = error instanceof TypeError;
      if (isNetworkError && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }

      if (isNetworkError) {
        throw new Error('Server tidak dapat dihubungi. Pastikan npm run dev masih berjalan.');
      }
      throw error;
    }
  }
}
