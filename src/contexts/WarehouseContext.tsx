'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { DatabaseService } from '@/lib/database'
import { useAuth } from './AuthContext'
import { Database } from '@/types/database'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Warehouse = Database['public']['Tables']['warehouses']['Row']

interface WarehouseContextType {
  warehouses: Warehouse[]
  loading: boolean
  refreshWarehouses: () => Promise<void>
  addWarehouse: (warehouse: Database['public']['Tables']['warehouses']['Insert']) => Promise<Warehouse>
  updateWarehouse: (id: string, updates: Database['public']['Tables']['warehouses']['Update']) => Promise<void>
  deleteWarehouse: (id: string) => Promise<void>
}

const WarehouseContext = createContext<WarehouseContextType | null>(null)

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)

  // Load warehouses from database
  const loadWarehouses = useCallback(async () => {
    if (!user) {
      setWarehouses([])
      setLoading(false)
      return
    }

    try {
      const data = await DatabaseService.getWarehouses()
      setWarehouses(data || [])
    } catch (error) {
      console.error('Error loading warehouses:', error)
      toast.error('Failed to load warehouses')
      setWarehouses([])
    } finally {
      setLoading(false)
    }
  }, [user])

  // Refresh warehouses manually
  const refreshWarehouses = async () => {
    await loadWarehouses()
  }

  // Add new warehouse
  const addWarehouse = async (warehouseData: Database['public']['Tables']['warehouses']['Insert']) => {
    try {
      const newWarehouse = await DatabaseService.createWarehouse(warehouseData)
      setWarehouses(prev => [...prev, newWarehouse])
      toast.success('Warehouse created successfully')
      return newWarehouse
    } catch (error) {
      console.error('Error creating warehouse:', error)
      toast.error('Failed to create warehouse')
      throw error
    }
  }

  // Update warehouse
  const updateWarehouse = async (id: string, updates: Database['public']['Tables']['warehouses']['Update']) => {
    try {
      await DatabaseService.updateWarehouse(id, updates)
      setWarehouses(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w))
      toast.success('Warehouse updated successfully')
    } catch (error) {
      console.error('Error updating warehouse:', error)
      toast.error('Failed to update warehouse')
      throw error
    }
  }

  // Delete warehouse
  const deleteWarehouse = async (id: string) => {
    try {
      await DatabaseService.deleteWarehouse(id)
      setWarehouses(prev => prev.filter(w => w.id !== id))
      toast.success('Warehouse deleted successfully')
    } catch (error) {
      console.error('Error deleting warehouse:', error)
      toast.error('Failed to delete warehouse')
      throw error
    }
  }

  // Load warehouses on mount and when user changes
  useEffect(() => {
    loadWarehouses()
  }, [loadWarehouses])

  // Set up real-time subscription for warehouse changes
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('warehouses_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'warehouses'
        },
        (payload) => {
          console.log('Warehouse change detected:', payload)
          
          switch (payload.eventType) {
            case 'INSERT':
              setWarehouses(prev => {
                // Check if warehouse already exists to prevent duplicates
                if (prev.find(w => w.id === payload.new.id)) {
                  return prev
                }
                return [...prev, payload.new as Warehouse]
              })
              break
              
            case 'UPDATE':
              setWarehouses(prev => 
                prev.map(w => w.id === payload.new.id ? payload.new as Warehouse : w)
              )
              break
              
            case 'DELETE':
              setWarehouses(prev => 
                prev.filter(w => w.id !== payload.old.id)
              )
              break
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const value: WarehouseContextType = {
    warehouses,
    loading,
    refreshWarehouses,
    addWarehouse,
    updateWarehouse,
    deleteWarehouse
  }

  return (
    <WarehouseContext.Provider value={value}>
      {children}
    </WarehouseContext.Provider>
  )
}

export function useWarehouses() {
  const context = useContext(WarehouseContext)
  if (!context) {
    throw new Error('useWarehouses must be used within a WarehouseProvider')
  }
  return context
}
