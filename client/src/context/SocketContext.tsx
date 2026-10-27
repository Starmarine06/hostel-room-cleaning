import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { LiveSocket, liveSocketUrl } from '../services/liveSocket';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: LiveSocket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<LiveSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading || !user) return;

    const live = new LiveSocket(liveSocketUrl(), () => localStorage.getItem('token'), setIsConnected);
    setSocket(live);

    return () => {
      live.close();
      setSocket(null);
      setIsConnected(false);
    };
  }, [user, authLoading]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
