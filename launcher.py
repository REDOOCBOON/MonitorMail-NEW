#!/usr/bin/env python3
"""
MonitorMail Desktop Launcher
Starts backend and frontend automatically, opens browser
"""

import os
import sys
import subprocess
import time
import webbrowser
import platform
from pathlib import Path

# Colors for console output
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def print_header():
    """Print welcome header"""
    print(f"\n{Colors.BLUE}")
    print("=" * 60)
    print("  🚀  MONITORMAIL LAUNCHER")
    print("=" * 60)
    print(f"{Colors.RESET}\n")

def check_dependencies():
    """Check if required packages are installed"""
    print(f"{Colors.YELLOW}📋 Checking dependencies...{Colors.RESET}")
    
    # Check Python version
    if sys.version_info < (3, 6):
        print(f"{Colors.RED}❌ Python 3.6+ required{Colors.RESET}")
        return False
    print(f"✅ Python {sys.version.split()[0]}")
    
    return True

# npm is a .cmd script on Windows and needs the shell; on macOS/Linux shell=True with a list would drop the arguments
USE_SHELL = os.name == 'nt'

def start_backend():
    """Start Flask backend"""
    print(f"\n{Colors.YELLOW}⚙️  Starting Backend (Flask)...{Colors.RESET}")
    
    backend_dir = Path(__file__).parent / "backend"
    
    try:
        # Start backend in a separate process
        process = subprocess.Popen(
            [sys.executable, "app.py"],
            cwd=str(backend_dir),
            stdout=open(backend_dir / "backend.log", "a"),  # a PIPE nobody reads would eventually block the server
            stderr=subprocess.STDOUT,
            shell=False
        )
        
        print(f"{Colors.GREEN}✅ Backend started (Process ID: {process.pid}){Colors.RESET}")
        print(f"   URL: http://127.0.0.1:5001  (log: backend/backend.log)")
        
        return process
    except Exception as e:
        print(f"{Colors.RED}❌ Failed to start backend: {e}{Colors.RESET}")
        return None

def start_frontend():
    """Start React frontend"""
    print(f"\n{Colors.YELLOW}⚙️  Starting Frontend (React)...{Colors.RESET}")
    
    frontend_dir = Path(__file__).parent / "frontend"
    
    try:
        # Check if node_modules exists
        node_modules = frontend_dir / "node_modules"
        if not node_modules.exists():
            print(f"{Colors.YELLOW}📦 Installing npm dependencies (first time only)...{Colors.RESET}")
            install_process = subprocess.Popen(
                ["npm", "install"],
                cwd=str(frontend_dir),
                shell=USE_SHELL
            )
            install_process.wait()
            if install_process.returncode != 0:
                print(f"{Colors.RED}❌ npm install failed{Colors.RESET}")
                return None
        
        # Start frontend
        process = subprocess.Popen(
            ["npm", "start"],
            cwd=str(frontend_dir),
            stdout=open(frontend_dir / "frontend.log", "a"),
            stderr=subprocess.STDOUT,
            shell=USE_SHELL,
            env={**os.environ, "BROWSER": "none"}  # Prevent browser auto-open
        )
        
        print(f"{Colors.GREEN}✅ Frontend started (Process ID: {process.pid}){Colors.RESET}")
        print(f"   URL: http://localhost:3000")
        
        return process
    except Exception as e:
        print(f"{Colors.RED}❌ Failed to start frontend: {e}{Colors.RESET}")
        return None

def wait_for_servers():
    """Wait for servers to be ready"""
    print(f"\n{Colors.YELLOW}⏳ Waiting for servers to start (20 seconds)...{Colors.RESET}")
    
    import socket
    
    backend_ready = False
    frontend_ready = False
    
    for i in range(20):
        # Check backend
        if not backend_ready:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                result = sock.connect_ex(('127.0.0.1', 5001))
                sock.close()
                if result == 0:
                    backend_ready = True
                    print(f"{Colors.GREEN}✅ Backend ready!{Colors.RESET}")
            except:
                pass
        
        # Check frontend
        if not frontend_ready:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                result = sock.connect_ex(('127.0.0.1', 3000))
                sock.close()
                if result == 0:
                    frontend_ready = True
                    print(f"{Colors.GREEN}✅ Frontend ready!{Colors.RESET}")
            except:
                pass
        
        if backend_ready and frontend_ready:
            print(f"{Colors.GREEN}✅ All servers are ready!{Colors.RESET}\n")
            return True
        
        time.sleep(1)
    
    print(f"{Colors.YELLOW}⚠️  Servers may still be starting... opening browser anyway{Colors.RESET}\n")
    return True

def open_browser():
    """Open MonitorMail in default browser"""
    print(f"{Colors.YELLOW}🌐 Opening MonitorMail in browser...{Colors.RESET}")
    
    try:
        webbrowser.open('http://localhost:3000')
        print(f"{Colors.GREEN}✅ Browser opened!{Colors.RESET}\n")
    except Exception as e:
        print(f"{Colors.YELLOW}⚠️  Could not auto-open browser: {e}{Colors.RESET}")
        print(f"   Please open: {Colors.BLUE}http://localhost:3000{Colors.RESET}\n")

def print_footer():
    """Print footer with instructions"""
    print(f"{Colors.BLUE}{'=' * 60}{Colors.RESET}")
    print(f"{Colors.GREEN}✅ MonitorMail is now running!{Colors.RESET}\n")
    print(f"   📱 Frontend: {Colors.BLUE}http://localhost:3000{Colors.RESET}")
    print(f"   ⚙️  Backend:  {Colors.BLUE}http://127.0.0.1:5001{Colors.RESET}\n")
    print(f"{Colors.YELLOW}💡 To stop, close this window or press Ctrl+C{Colors.RESET}")
    print(f"{Colors.BLUE}{'=' * 60}\n{Colors.RESET}")

def main():
    """Main launcher function"""
    print_header()
    
    # Check dependencies
    if not check_dependencies():
        print(f"{Colors.RED}Please install required packages and try again.{Colors.RESET}")
        input("Press Enter to exit...")
        sys.exit(1)
    
    # Start backend
    backend_process = start_backend()
    if not backend_process:
        print(f"{Colors.RED}Failed to start backend!{Colors.RESET}")
        input("Press Enter to exit...")
        sys.exit(1)
    
    time.sleep(2)
    
    # Start frontend
    frontend_process = start_frontend()
    if not frontend_process:
        print(f"{Colors.RED}Failed to start frontend!{Colors.RESET}")
        backend_process.terminate()
        input("Press Enter to exit...")
        sys.exit(1)
    
    time.sleep(2)
    
    # Wait for servers to be ready
    wait_for_servers()
    
    # Open browser
    open_browser()
    
    # Print footer
    print_footer()
    
    try:
        # Keep processes running
        while True:
            if backend_process.poll() is not None:
                print(f"{Colors.RED}Backend process stopped!{Colors.RESET}")
                break
            if frontend_process.poll() is not None:
                print(f"{Colors.RED}Frontend process stopped!{Colors.RESET}")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Shutting down MonitorMail...{Colors.RESET}")
        backend_process.terminate()
        frontend_process.terminate()
        print(f"{Colors.GREEN}✅ MonitorMail closed.{Colors.RESET}\n")
        sys.exit(0)

if __name__ == "__main__":
    main()
