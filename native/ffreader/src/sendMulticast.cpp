#include <cstring> // For memset
#include <iostream>
#include <string>
#include <sys/types.h>
#ifdef _WIN32
#include <Winsock2.h>
typedef int socklen_t;
#pragma comment(lib, "Ws2_32.lib")
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h> // Include for close function on Unix-like systems
#endif

#include "sendMulticast.hpp"

// Function to initialize network environment on Windows
void initializeNetwork() {
#ifdef _WIN32
  WSADATA wsaData;
  int result = WSAStartup(MAKEWORD(2, 2), &wsaData);
  if (result != 0) {
    std::cerr << "WSAStartup failed: " << result << std::endl;
    exit(1);
  }
#endif
}

// Function to clean up network environment on Windows
void cleanupNetwork() {
#ifdef _WIN32
  WSACleanup();
#endif
}

// Function to send a string via UDP multicast
int sendMulticast(const std::string &message, const std::string &multicastIP,
                  unsigned short port) {
  initializeNetwork();

  int sockfd = socket(AF_INET, SOCK_DGRAM, 0);
  if (sockfd < 0) {
    std::cerr << "Error opening socket" << std::endl;
    cleanupNetwork();
    return 1;
  }

  // Set up destination address
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = inet_addr(multicastIP.c_str());
  addr.sin_port = htons(port);

  // Send the message
  if (sendto(sockfd, message.c_str(), message.length(), 0,
             (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    std::cerr << "Error sending the message" << std::endl;
#ifdef WIN32
    closesocket(sockfd);
#else
    close(sockfd);
#endif
    cleanupNetwork();
    return 1;
  }

  // std::cout << "Message sent successfully" << std::endl;

#ifdef WIN32
    closesocket(sockfd);
#else
    close(sockfd);
#endif
  cleanupNetwork();
  return 0;
}

int main() {
  std::string multicastIP = "224.0.0.1";     // Example multicast IP address
  unsigned short port = 12345;               // Example port
  std::string message = "Hello, Multicast!"; // Example message

  sendMulticast(message, multicastIP, port);

  return 0;
}
