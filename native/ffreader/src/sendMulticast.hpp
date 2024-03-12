#include <string>

// Function to initialize network environment on Windows
void initializeNetwork();

// Function to clean up network environment on Windows
void cleanupNetwork();

// Function to send a string via UDP multicast
int sendMulticast(const std::string &message, const std::string &multicastIP,
                  unsigned short port);
