// Unit tests for arda service
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the process.env before importing
const originalEnv = process.env;

describe('arda service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isMockMode', () => {
    it('should return true when ARDA_MOCK_MODE is true', async () => {
      process.env.ARDA_MOCK_MODE = 'true';
      process.env.ARDA_API_KEY = 'test-key';
      process.env.ARDA_TENANT_ID = 'test-tenant';
      
      const { isMockMode } = await import('./arda.js');
      expect(isMockMode()).toBe(true);
    });

    it('should return true when ARDA_API_KEY is not set', async () => {
      delete process.env.ARDA_API_KEY;
      delete process.env.ARDA_TENANT_ID;
      delete process.env.ARDA_MOCK_MODE;
      
      const { isMockMode } = await import('./arda.js');
      expect(isMockMode()).toBe(true);
    });

    it('should return true when ARDA_TENANT_ID is placeholder', async () => {
      process.env.ARDA_API_KEY = 'real-key';
      process.env.ARDA_TENANT_ID = 'your_tenant_uuid_here';
      delete process.env.ARDA_MOCK_MODE;
      
      const { isMockMode } = await import('./arda.js');
      expect(isMockMode()).toBe(true);
    });
  });

  describe('ardaService.isConfigured', () => {
    it('should return false when API key is missing', async () => {
      delete process.env.ARDA_API_KEY;
      process.env.ARDA_TENANT_ID = 'valid-tenant';
      
      const { ardaService } = await import('./arda.js');
      expect(ardaService.isConfigured()).toBe(false);
    });

    it('should return false when tenant ID is placeholder', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'your_tenant_uuid_here';
      
      const { ardaService } = await import('./arda.js');
      expect(ardaService.isConfigured()).toBe(false);
    });

    it('should return true when properly configured', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'c35bb200-ce7f-4280-9108-f61227127a98';
      
      const { ardaService } = await import('./arda.js');
      expect(ardaService.isConfigured()).toBe(true);
    });
  });

  describe('interfaces', () => {
    it('should have ItemInput interface exported', async () => {
      const ardaModule = await import('./arda.js');
      // TypeScript types are compile-time only, but we can verify the module exports
      expect(ardaModule).toBeDefined();
      expect(ardaModule.ardaService).toBeDefined();
    });
  });
});
