import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading || !user) return;

    // One variable is enough: the live-update server lives at the same address as the API
    const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
    const socketUrl = import.meta.env.VITE_SOCKET_URL || (apiUrl ? new URL(apiUrl).origin : 'http://localhost:4000');
    const newSocket = io(socketUrl, {
      auth: { token: localStorage.getItem('token') },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
      
      // Join relevant rooms
      if (user.roomId) {
        newSocket.emit('join-room', user.roomId);
      }
      if (user.role === 'CLEANER') {
        newSocket.emit('join-cleaners');
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
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