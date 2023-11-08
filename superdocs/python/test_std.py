# import sys

# # Reading from standard input
# def read_from_stdin():
#     print("Please enter some input: ")
#     input_data = sys.stdin.readline().strip()
#     return input_data

# # Writing to standard output
# def write_to_stdout(output_data):
#     sys.stdout.write(f"Output: {output_data}\n")
#     sys.stdout.flush()

# # Example usage
# if __name__ == '__main__':
#     user_input = read_from_stdin()
#     processed_data = user_input.upper()
#     write_to_stdout(processed_data)

import sys

# Save the current standard output
original_stdout = sys.stdout

# Redirect standard output to a variable
sys.stdout = open('stdout.txt', 'w')  # Open a file to store the standard output

# Your program's logic that writes to standard output
print("This is a message written to standard output")
print("Another line of output")

# Reset standard output
sys.stdout = original_stdout

# Read the contents of the file
with open('stdout.txt', 'r') as file:
    contents = file.read()
    print("Contents of the standard output:")
    print(contents)
