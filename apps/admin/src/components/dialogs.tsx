'use client';
import dynamic from 'next/dynamic';

/**
 * The confirm dialogs, loaded on first open: every page has them, but they only appear after a
 * click, so they stay out of each page's first-load JavaScript.
 */
export const ActionDialog = dynamic(() => import('./ActionDialog').then((m) => m.ActionDialog));
export const FormDialog = dynamic(() => import('./FormDialog').then((m) => m.FormDialog));
