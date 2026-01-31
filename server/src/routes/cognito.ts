// Cognito API Routes - User lookup and sync endpoints
import { Router, Request, Response } from 'express';
import { cognitoService } from '../services/cognito.js';

const router = Router();

// Get sync status
router.get('/status', (req: Request, res: Response) => {
  const status = cognitoService.getSyncStatus();
  res.json({
    success: true,
    ...status,
    message: status.userCount > 0 
      ? `${status.userCount} users loaded` 
      : 'No users loaded - run sync',
  });
});

// Look up user by email
router.get('/lookup', (req: Request, res: Response) => {
  const email = req.query.email as string;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      error: 'Email query parameter required' 
    });
  }
  
  const user = cognitoService.getUserByEmail(email);
  
  if (user) {
    res.json({
      success: true,
      user: {
        email: user.email,
        tenantId: user.tenantId,
        author: user.sub,
        name: user.name,
        role: user.role,
      },
    });
  } else {
    res.json({
      success: false,
      message: `No user found for email: ${email}`,
    });
  }
});

// Trigger manual sync from GitHub
router.post('/sync', async (req: Request, res: Response) => {
  try {
    console.log('📡 Manual Cognito sync triggered');
    const success = await cognitoService.syncUsersFromGitHub();
    
    if (success) {
      const status = cognitoService.getSyncStatus();
      res.json({
        success: true,
        message: `Sync completed. ${status.userCount} users loaded.`,
        ...status,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Sync failed - check server logs',
      });
    }
  } catch (error) {
    console.error('Cognito sync error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Sync failed',
    });
  }
});

// Reload from local file (without triggering GitHub workflow)
router.post('/reload', (req: Request, res: Response) => {
  try {
    cognitoService.loadUsersFromFile();
    const status = cognitoService.getSyncStatus();
    res.json({
      success: true,
      message: `Reloaded ${status.userCount} users from file`,
      ...status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Reload failed',
    });
  }
});

// List all users (admin endpoint)
router.get('/users', (req: Request, res: Response) => {
  const users = cognitoService.getAllUsers();
  res.json({
    success: true,
    count: users.length,
    users: users.map(u => ({
      email: u.email,
      tenantId: u.tenantId,
      author: u.sub,
      name: u.name,
      role: u.role,
    })),
  });
});

export default router;
