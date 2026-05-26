import collections
import threading
from datetime import datetime

class LogBufferProcessor:
    def __init__(self, maxlen=150):
        self.buffer = collections.deque(maxlen=maxlen)
        self.lock = threading.Lock()

    def __call__(self, logger, name, event_dict):
        # Create a thread-safe snapshot of the log entry
        log_entry = dict(event_dict)
        
        # Ensure timestamp is set
        if "timestamp" not in log_entry:
            log_entry["timestamp"] = datetime.utcnow().isoformat() + "Z"
            
        # Ensure log level is captured
        if "level" not in log_entry:
            log_entry["level"] = name.upper()
            
        with self.lock:
            self.buffer.append(log_entry)
            
        return event_dict

    def get_logs(self):
        with self.lock:
            return list(self.buffer)

# Global singleton buffer instance
global_log_buffer = LogBufferProcessor()
