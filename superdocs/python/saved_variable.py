import pickle
import os

class SavedList:
    def __init__(self, filepath):
        self.filepath = filepath
        self.values = []
        self.get()

    def set(self, value):
        self.value = value
        with open(self.filepath, 'wb+') as handle:
            pickle.dump(value, handle, protocol=pickle.HIGHEST_PROTOCOL)

    def get(self):
        if not(os.path.exists(self.filepath)):
            self.value = []
            return []

        with open(self.filepath, 'rb') as handle:
            self.value = pickle.load(self.filepath)
        return self.value
    