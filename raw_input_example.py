import ctypes
from ctypes import wintypes
import sys

# Constants
RIDEV_INPUTSINK = 0x00000100
RID_INPUT = 0x10000003
RIM_TYPEKEYBOARD = 1
WM_INPUT = 0x00FF
VK_F1 = 0x70

# Structs
class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
        ("dwFlags", wintypes.DWORD),
        ("hwndTarget", wintypes.HWND),
    ]

class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [
        ("dwType", wintypes.DWORD),
        ("dwSize", wintypes.DWORD),
        ("hDevice", wintypes.HANDLE),
        ("wParam", wintypes.WPARAM),
    ]

# Setup User32
user32 = ctypes.windll.user32

def main():
    print("Starting Raw Input Listener (Python)...")
    
    # 1. Create a Message-Only Window
    # For simplicity in Python, we can try to use the console window HWND or create a dummy one.
    # Using 'None' (NULL) as hwndTarget with RIDEV_INPUTSINK effectively monitors system-wide input
    # IF we have a message loop running on this thread.
    
    # However, RIDEV_INPUTSINK requires an explicit HWND to receive messages when in background.
    # Let's create a hidden window.
    
    WNDPROCTYPE = ctypes.WINFUNCTYPE(ctypes.c_long, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    
    class WNDCLASSEX(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT),
                    ("style", wintypes.UINT),
                    ("lpfnWndProc", WNDPROCTYPE),
                    ("cbClsExtra", wintypes.INT),
                    ("cbWndExtra", wintypes.INT),
                    ("hInstance", wintypes.HANDLE),
                    ("hIcon", wintypes.HANDLE),
                    ("hCursor", wintypes.HANDLE),
                    ("hbrBackground", wintypes.HANDLE),
                    ("lpszMenuName", wintypes.LPCWSTR),
                    ("lpszClassName", wintypes.LPCWSTR),
                    ("hIconSm", wintypes.HANDLE)]

    def py_wnd_proc(hwnd, msg, wparam, lparam):
        if msg == WM_INPUT:
            # Handle Raw Input
            header = RAWINPUTHEADER()
            size = ctypes.c_uint(ctypes.sizeof(header))
            
            # First call to get size (optional if we use large buffer, but good practice)
            # Here we just want to know a key was pressed.
            
            # To actually read data, we need the full RAWINPUT struct definition which varies by union.
            # For demonstration, we just print "Input received".
            print(f"WM_INPUT received. lParam: {lparam}")
            
            # IMPORTANT: For detailed key info, you need to parse RAWINPUT struct.
            
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    wnd_proc = WNDPROCTYPE(py_wnd_proc)
    hinst = ctypes.windll.kernel32.GetModuleHandleW(None)
    
    class_name = "PythonRawInputClass"
    
    wcls = WNDCLASSEX()
    wcls.cbSize = ctypes.sizeof(WNDCLASSEX)
    wcls.lpfnWndProc = wnd_proc
    wcls.hInstance = hinst
    wcls.lpszClassName = class_name
    
    if not user32.RegisterClassExW(ctypes.byref(wcls)):
        print("Failed to register window class")
        return

    hwnd = user32.CreateWindowExW(0, class_name, "Hidden Window", 0, 0, 0, 0, 0, 0, 0, hinst, 0)
    
    if not hwnd:
        print("Failed to create window")
        return

    # 2. Register Raw Input Device
    rid = RAWINPUTDEVICE()
    rid.usUsagePage = 0x01 # Generic Desktop Controls
    rid.usUsage = 0x06     # Keyboard
    rid.dwFlags = RIDEV_INPUTSINK # Receive input even when not in foreground
    rid.hwndTarget = hwnd

    if not user32.RegisterRawInputDevices(ctypes.byref(rid), 1, ctypes.sizeof(rid)):
        print("Failed to register raw input device")
        return

    print("Listening for input... (Press Ctrl+C to stop in console context, though msg loop blocks)")

    # 3. Message Loop
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), 0, 0, 0) != 0:
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))

if __name__ == "__main__":
    main()
